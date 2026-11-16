package com.aitutor.controller;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.Semaphore;

@Service
public class SandboxExecutionService {
    private final boolean enabled; private final int timeoutSeconds; private final long memoryMb;
    private final Map<String,String> images;
    private final Set<String> preparedImages = java.util.concurrent.ConcurrentHashMap.newKeySet();
    private final Semaphore concurrency = new Semaphore(4);
    private final RemoteCodeRunner remote;
    private final String provider;
    private volatile long dockerCheckedAt = 0L;
    private volatile boolean dockerAvailable = false;

    public SandboxExecutionService(@Value("${app.code-runner.enabled:false}") boolean enabled,
                                   @Value("${app.code-runner.timeout-seconds:5}") int timeoutSeconds,
                                   @Value("${app.code-runner.memory-mb:256}") long memoryMb,
                                   @Value("${app.code-runner.java-image:eclipse-temurin:21-jdk}") String javaImage,
                                   @Value("${app.code-runner.python-image:python:3.12-alpine}") String pythonImage,
                                   @Value("${app.code-runner.cpp-image:gcc:14}") String cppImage,
                                   @Value("${app.code-runner.node-image:node:22-alpine}") String nodeImage,
                                   @Value("${app.code-runner.go-image:golang:1.24-alpine}") String goImage,
                                   @Value("${app.code-runner.provider:auto}") String provider,
                                   RemoteCodeRunner remote) {
        this.enabled=enabled; this.timeoutSeconds=Math.max(1,Math.min(15,timeoutSeconds)); this.memoryMb=Math.max(128,Math.min(1024,memoryMb));
        this.images=Map.of("java",javaImage,"python",pythonImage,"c++",cppImage,"c",cppImage,"javascript",nodeImage,"go",goImage);
        this.provider = provider == null || provider.isBlank() ? "auto" : provider.trim().toLowerCase(Locale.ROOT);
        this.remote = remote;
    }

    public Map<String,Object> execute(String language,String code,String stdin) {
        String lang=Optional.ofNullable(language).orElse("Java").trim().toLowerCase(Locale.ROOT);
        if(!images.containsKey(lang)) throw new IllegalArgumentException("Unsupported execution language: "+language);
        if(code==null||code.isBlank()) throw new IllegalArgumentException("Code is empty");
        if(code.length()>100_000) throw new IllegalArgumentException("Code is too large for the sandbox");
        if(!enabled) return Map.of("enabled",false,"status","SANDBOX_NOT_ENABLED","message","Code execution is disabled until the sandbox is configured. Static/AI analysis remains available.");
        // Deployments without a Docker host (free PaaS) execute through the isolated
        // remote runner instead. The judge contract is identical either way.
        if (useRemote()) return remote.execute(lang, code, stdin);
        if (!concurrency.tryAcquire()) return Map.of("enabled",true,"status","RUNNER_BUSY","exitCode",-1,"stdout","","stderr","The code execution service is busy. Please retry shortly.");
        Path dir=null;
        try {
            ensureDockerReady();
            ensureImage(images.get(lang));
            dir=Files.createTempDirectory("novatutor-run-");
            String file=switch(lang){case "java"->"Main.java";case "python"->"main.py";case "javascript"->"main.js";case "go"->"main.go";default->"main.c";};
            Files.writeString(dir.resolve(file),code,StandardCharsets.UTF_8,StandardOpenOption.CREATE_NEW);
            List<String> command=command(lang,file,dir);
            String cid="novatutor-"+UUID.randomUUID().toString().substring(0,13);
            // Named container so a force-killed docker client cannot leave an
            // orphaned container running server-side (docker run --rm only cleans
            // up when the client connection ends normally).
            int nameIdx=command.indexOf("--rm");
            command.add(nameIdx+1,"--name"); command.add(nameIdx+2,cid);
            ProcessBuilder pb=new ProcessBuilder(command).redirectErrorStream(true);
            Process process=pb.start();
            // Write stdin and drain stdout concurrently. Writing the whole stdin
            // before waiting deadlocks when the program produces more output than
            // the OS pipe buffer (64KB) can hold, because waitFor() never starts
            // while the child blocks on write.
            final byte[] stdinBytes=(stdin==null||stdin.isEmpty())?null:stdin.getBytes(StandardCharsets.UTF_8);
            Thread writer=null;
            if(stdinBytes!=null){
                writer=new Thread(()->{
                    try(OutputStream os=process.getOutputStream()){os.write(stdinBytes);os.flush();}
                    catch(IOException ignored){/* child exited early; nothing to feed */}
                },"sandbox-stdin");
                writer.setDaemon(true);
                writer.start();
            } else {
                process.getOutputStream().close();
            }
            StringBuilder output=new StringBuilder();
            char[] buf=new char[8192];
            int total=0; boolean exceeded=false;
            try(java.io.Reader r=new java.io.InputStreamReader(process.getInputStream(),StandardCharsets.UTF_8)){
                int n;
                long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(timeoutSeconds);
                while((n=r.read(buf))>=0){
                    output.append(buf,0,n);
                    total+=n;
                    if(total>400_000){exceeded=true;break;}
                    if(System.nanoTime()>deadline){break;}
                }
            }
            boolean finished=process.waitFor(timeoutSeconds, TimeUnit.SECONDS);
            if(writer!=null){writer.join(2000);}
            if(!finished||exceeded){process.destroyForcibly(); process.waitFor(2,TimeUnit.SECONDS); killContainer(cid);
                if(exceeded) return Map.of("enabled",true,"status","OUTPUT_LIMIT","exitCode",-1,"stdout",truncate(output.toString()),"stderr","Execution produced too much output.","durationMs",timeoutSeconds*1000);
                return Map.of("enabled",true,"status","TIMEOUT","exitCode",-1,"stdout",truncate(output.toString()),"stderr","Execution exceeded the sandbox time limit.","durationMs",timeoutSeconds*1000);}
            String out=output.toString();
            return Map.of("enabled",true,"status",process.exitValue()==0?"PASSED":"RUNTIME_ERROR","exitCode",process.exitValue(),"stdout",truncate(out),"stderr",process.exitValue()==0?"":"Process exited with a non-zero status.","durationMs",0);
        } catch(IOException e){return Map.of("enabled",true,"status","RUNNER_UNAVAILABLE","exitCode",-1,"stdout","","stderr","Docker sandbox is unavailable. Start Docker Desktop and make sure the configured runner image can be pulled.","detail",e.getMessage());}
        catch(InterruptedException e){Thread.currentThread().interrupt();return Map.of("enabled",true,"status","INTERRUPTED","exitCode",-1,"stdout","","stderr","Execution was interrupted.");}
        finally{concurrency.release(); if(dir!=null)try{Files.walk(dir).sorted(Comparator.reverseOrder()).forEach(x->{try{Files.deleteIfExists(x);}catch(IOException ignored){}});}catch(IOException ignored){}}
    }

    /**
     * Chooses the execution substrate. `remote` always uses the isolated remote
     * runner, `docker` always uses local containers, and `auto` prefers Docker
     * and falls back to the remote runner when no Docker daemon is reachable
     * (the normal case on free PaaS web services).
     */
    private boolean useRemote(){
        if("remote".equals(provider)) return true;
        if("docker".equals(provider)) return false;
        return !dockerAvailableCached();
    }

    private boolean dockerAvailableCached(){
        long now=System.currentTimeMillis();
        if(now-dockerCheckedAt<60_000L) return dockerAvailable;
        try{ ensureDockerReady(); dockerAvailable=true; }
        catch(Exception e){ dockerAvailable=false; }
        dockerCheckedAt=now;
        return dockerAvailable;
    }

    /** Best-effort force-remove of a killed run's container. */
    private void killContainer(String cid){
        try {
            Process p=new ProcessBuilder("docker","rm","-f",cid).start();
            p.waitFor(5,TimeUnit.SECONDS);
            p.destroyForcibly();
        } catch(Exception ignored){/* best effort */}
    }

    private void ensureDockerReady() throws IOException {
        ProcessBuilder pb=new ProcessBuilder("docker","info","--format","{{.ServerVersion}}");
        Process p=pb.redirectErrorStream(true).start();
        try {
            if(!p.waitFor(8,TimeUnit.SECONDS)||p.exitValue()!=0){
                String detail=new String(p.getInputStream().readAllBytes(),StandardCharsets.UTF_8).trim();
                throw new IOException("Docker is not running or is unavailable. "+detail);
            }
        } catch(InterruptedException e){Thread.currentThread().interrupt();throw new IOException("Docker preflight was interrupted",e);}
    }

    private void ensureImage(String image) throws IOException {
        if(preparedImages.contains(image)) return;
        ProcessBuilder inspect=new ProcessBuilder("docker","image","inspect",image).redirectErrorStream(true);
        Process p=inspect.start();
        try {
            boolean finished=p.waitFor(10,TimeUnit.SECONDS);
            if(finished&&p.exitValue()==0){preparedImages.add(image);return;}
        } catch(InterruptedException e){Thread.currentThread().interrupt();throw new IOException("Docker image check was interrupted",e);}
        ProcessBuilder pull=new ProcessBuilder("docker","pull",image).redirectErrorStream(true);
        Process pp=pull.start();
        try {
            if(!pp.waitFor(90,TimeUnit.SECONDS)||pp.exitValue()!=0){
                String detail=new String(pp.getInputStream().readAllBytes(),StandardCharsets.UTF_8).trim();
                throw new IOException("Could not pull sandbox image "+image+". "+detail);
            }
            preparedImages.add(image);
        } catch(InterruptedException e){Thread.currentThread().interrupt();throw new IOException("Docker image pull was interrupted",e);}
    }

    private List<String> command(String lang,String file,Path dir){
        String mount=dir.toAbsolutePath().toString(); String image=images.get(lang);
        List<String> base=new ArrayList<>(List.of("docker","run","--rm","--network","none","--cpus","0.5","--memory",memoryMb+"m","--pids-limit","64","--ulimit","nofile=256:256","--security-opt","no-new-privileges","--cap-drop","ALL","--read-only","--tmpfs","/tmp:rw,nosuid,size=64m","-v",mount+":/workspace:rw","-w","/workspace",image));
        switch(lang){case "java"->base.addAll(List.of("sh","-lc","javac Main.java && java Main"));case "python"->base.addAll(List.of("python","main.py"));case "javascript"->base.addAll(List.of("node","main.js"));case "go"->base.addAll(List.of("go","run","main.go"));case "c++"->base.addAll(List.of("sh","-lc","g++ -std=c++20 -O2 main.c -o /workspace/a.out && /workspace/a.out"));default->base.addAll(List.of("sh","-lc","gcc -std=c17 -O2 main.c -o /workspace/a.out && /workspace/a.out"));}
        return base;
    }
    private String truncate(String s){return s==null?"":s.length()>12000?s.substring(0,12000)+"\n[output truncated]":s;}
}
