package com.aitutor.dsa;

/** Typed functional interfaces for reference oracles. GENERATED. */
public final class DsaFns {
    private DsaFns() {}

    public interface FSI2S { String apply(String p0, int p1); }

    public interface FA2A { int[] apply(int[] p0); }
    public interface FA2I { int apply(int[] p0); }
    public interface FAI2I { int apply(int[] p0, int p1); }
    public interface FAS2I { int apply(int[] p0, String p1); }
    public interface FI2A { int[] apply(int p0); }
    public interface FI2I { int apply(int p0); }
    public interface FI2M { int[][] apply(int p0); }
    public interface FII2I { int apply(int p0, int p1); }
    public interface FS2I { int apply(String p0); }
    public interface FS2S { String apply(String p0); }
    public interface FSI2I { int apply(String p0, int p1); }
    public interface FSS2I { int apply(String p0, String p1); }
    public interface FSS2S { String apply(String p0, String p1); }
    public interface FSSS2I { int apply(String p0, String p1, String p2); }
}
