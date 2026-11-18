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
            Path srcPath = dir.resolve(file);
            Files.writeString(srcPath,code,StandardCharsets.UTF_8,StandardOpenOption.CREATE_NEW);
            // Make temp dir and source file readable by unprivileged container user (65534:65534).
            dir.toFile().setReadable(true, false);
            dir.toFile().setExecutable(true, false);
            srcPath.toFile().setReadable(true, false);
            List<String> command=command(lang,file,dir);
            String cid="novatutor-"+UUID.randomUUID().toString().substring(0,13);
            // Named container so a force-killed docker client cannot leave an
            // orphaned container running server-side (docker run --rm only cleans
            // up when the client connection ends normally).
            int nameIdx=command.indexOf("--rm");
            command.add(nameIdx+1,"--name"); command.add(nameIdx+2,cid);
            ProcessBuilder pb=new ProcessBuilder(command);
            Process process=pb.start();
            try {
                // Write stdin and drain stdout + stderr concurrently to prevent pipe deadlocks
                // and keep compiler/runtime errors separate from program stdout.
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
                StringBuilder stdoutBuf = new StringBuilder();
                StringBuilder stderrBuf = new StringBuilder();
                java.util.concurrent.atomic.AtomicBoolean exceeded = new java.util.concurrent.atomic.AtomicBoolean(false);
                Thread stdoutReader = drainStream(process.getInputStream(), stdoutBuf, exceeded, process, "sandbox-stdout");
                Thread stderrReader = drainStream(process.getErrorStream(), stderrBuf, exceeded, process, "sandbox-stderr");

                long startedAt = System.nanoTime();
                boolean finished = process.waitFor(timeoutSeconds, TimeUnit.SECONDS);
                long durationMs = (System.nanoTime() - startedAt) / 1_000_000L;
                if (!finished || exceeded.get()) {
                    process.destroyForcibly();
                    process.waitFor(2, TimeUnit.SECONDS);
                    killContainer(cid);
                    stdoutReader.join(1000);
                    stderrReader.join(1000);
                    if (writer != null) writer.join(1000);
                    String outSnap;
                    synchronized (stdoutBuf) { outSnap = stdoutBuf.toString(); }
                    if (exceeded.get()) {
                        return Map.of("enabled", true, "status", "OUTPUT_LIMIT", "exitCode", -1,
                                "stdout", truncate(outSnap), "stderr", "Execution produced too much output.",
                                "durationMs", durationMs);
                    }
                    return Map.of("enabled", true, "status", "TIMEOUT", "exitCode", -1,
                            "stdout", truncate(outSnap), "stderr", "Execution exceeded the sandbox time limit.",
                            "durationMs", timeoutSeconds * 1000L);
                }
                stdoutReader.join(2000);
                stderrReader.join(2000);
                if (writer != null) writer.join(2000);
                String out;
                String err;
                synchronized (stdoutBuf) { out = stdoutBuf.toString(); }
                synchronized (stderrBuf) { err = stderrBuf.toString(); }
                int exit = process.exitValue();
                // Docker reports an OOM kill of a --memory-capped container as 137 (SIGKILL).
                if (exit == 137) return Map.of("enabled", true, "status", "MEMORY_LIMIT", "exitCode", -1, "stdout", truncate(out), "stderr", "Memory limit exceeded: the sandbox stopped the process at the configured " + memoryMb + " MB limit.", "durationMs", durationMs, "memoryKb", memoryMb * 1024);
                // Exit code 99 is reserved by compiled-language commands to indicate compilation failure.
                if (exit == 99) return Map.of("enabled", true, "status", "COMPILE_ERROR", "exitCode", exit, "stdout", "", "stderr", truncate(err.isBlank() ? out : err), "durationMs", durationMs);
                return Map.of("enabled", true, "status", exit == 0 ? "OK" : "RUNTIME_ERROR", "exitCode", exit, "stdout", truncate(out), "stderr", exit == 0 ? truncate(err) : truncate(err.isBlank() ? "Process exited with a non-zero status." : err), "durationMs", durationMs);
            } catch (InterruptedException e) {
                process.destroyForcibly();
                killContainer(cid);
                Thread.currentThread().interrupt();
                return Map.of("enabled",true,"status","INTERRUPTED","exitCode",-1,"stdout","","stderr","Execution was interrupted.");
            }
        } catch(IOException e){return Map.of("enabled",true,"status","RUNNER_UNAVAILABLE","exitCode",-1,"stdout","","stderr","Docker sandbox is unavailable. Start Docker Desktop and make sure the configured runner image can be pulled.","detail",e.getMessage());}
        finally{concurrency.release(); if(dir!=null)try{Files.walk(dir).sorted(Comparator.reverseOrder()).forEach(x->{try{Files.deleteIfExists(x);}catch(IOException ignored){}});}catch(IOException ignored){}}
    }

    private Thread drainStream(InputStream is, StringBuilder target, java.util.concurrent.atomic.AtomicBoolean exceeded,
                               Process process, String name) {
        Thread t = new Thread(() -> {
            char[] buf = new char[8192];
            int total = 0;
            try (Reader r = new InputStreamReader(is, StandardCharsets.UTF_8)) {
                int n;
                while ((n = r.read(buf)) >= 0) {
                    synchronized (target) {
                        target.append(buf, 0, n);
                    }
                    total += n;
                    if (total > 400_000) {
                        exceeded.set(true);
                        process.destroyForcibly();
                        break;
                    }
                }
            } catch (IOException ignored) {
                // Stream closed when process terminated or timed out
            }
        }, name);
        t.setDaemon(true);
        t.start();
        return t;
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
            if(!p.waitFor(8,TimeUnit.SECONDS)){
                p.destroyForcibly();
                throw new IOException("Docker preflight timed out.");
            }
            if(p.exitValue()!=0){
                String detail=new String(p.getInputStream().readAllBytes(),StandardCharsets.UTF_8).trim();
                throw new IOException("Docker is not running or is unavailable. "+detail);
            }
        } catch(InterruptedException e){
            p.destroyForcibly();
            Thread.currentThread().interrupt();
            throw new IOException("Docker preflight was interrupted",e);
        }
    }

    private void ensureImage(String image) throws IOException {
        if(preparedImages.contains(image)) return;
        ProcessBuilder inspect=new ProcessBuilder("docker","image","inspect",image).redirectErrorStream(true);
        Process p=inspect.start();
        try {
            boolean finished=p.waitFor(10,TimeUnit.SECONDS);
            if(!finished) p.destroyForcibly();
            else if(p.exitValue()==0){preparedImages.add(image);return;}
        } catch(InterruptedException e){
            p.destroyForcibly();
            Thread.currentThread().interrupt();
            throw new IOException("Docker image check was interrupted",e);
        }
        ProcessBuilder pull=new ProcessBuilder("docker","pull",image).redirectErrorStream(true);
        Process pp=pull.start();
        try {
            if(!pp.waitFor(90,TimeUnit.SECONDS)){
                pp.destroyForcibly();
                throw new IOException("Timed out pulling sandbox image "+image);
            }
            if(pp.exitValue()!=0){
                String detail=new String(pp.getInputStream().readAllBytes(),StandardCharsets.UTF_8).trim();
                throw new IOException("Could not pull sandbox image "+image+". "+detail);
            }
            preparedImages.add(image);
        } catch(InterruptedException e){
            pp.destroyForcibly();
            Thread.currentThread().interrupt();
            throw new IOException("Docker image pull was interrupted",e);
        }
    }

    List<String> command(String lang,String file,Path dir){
        String mount=dir.toAbsolutePath().toString(); String image=images.get(lang);
        List<String> base=new ArrayList<>(List.of(
                "docker","run","--rm","--user","65534:65534",
                "--network","none","--cpus","0.5",
                "--memory",memoryMb+"m","--memory-swap",memoryMb+"m",
                "--pids-limit","64","--ulimit","nofile=256:256",
                "--security-opt","no-new-privileges","--cap-drop","ALL",
                "--read-only","--tmpfs","/tmp:rw,nosuid,mode=1777,size=64m",
                "-e","HOME=/tmp","-e","GOCACHE=/tmp/.cache","-e","GOPATH=/tmp/go",
                "-v",mount+":/workspace:ro","-w","/tmp",image));
        switch(lang){
            case "java"->base.addAll(List.of("sh","-c","javac -d /tmp /workspace/Main.java || exit 99; exec java -cp /tmp Main"));
            case "python"->base.addAll(List.of("python","/workspace/main.py"));
            case "javascript"->base.addAll(List.of("node","/workspace/main.js"));
            case "go"->base.addAll(List.of("sh","-c","go build -o /tmp/a.out /workspace/main.go || exit 99; exec /tmp/a.out"));
            case "c++"->base.addAll(List.of("sh","-c","g++ -std=c++20 -O2 /workspace/main.c -o /tmp/a.out || exit 99; exec /tmp/a.out"));
            default->base.addAll(List.of("sh","-c","gcc -std=c17 -O2 /workspace/main.c -o /tmp/a.out || exit 99; exec /tmp/a.out"));
        }
        return base;
    }
    private String truncate(String s){return s==null?"":s.length()>12000?s.substring(0,12000)+"\n[output truncated]":s;}
}
