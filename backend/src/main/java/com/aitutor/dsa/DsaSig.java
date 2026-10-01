package com.aitutor.dsa;

import java.util.List;

/**
 * The call signature of a DSA problem's solve function. GENERATED from the
 * problem banks — every entry is actually used by at least one problem.
 * Param kinds: A=int[], M=int[][], I=int, S=String.
 * Test input line = parameters joined with '|', one test per line.
 */
public enum DsaSig {
    /** A2A */
    A2A(List.of(DsaKind.ARRAY), DsaKind.ARRAY),
    /** A2I */
    A2I(List.of(DsaKind.ARRAY), DsaKind.INT),
    /** AI2I */
    AI2I(List.of(DsaKind.ARRAY, DsaKind.SCALAR), DsaKind.INT),
    /** AS2I */
    AS2I(List.of(DsaKind.ARRAY, DsaKind.STRING), DsaKind.INT),
    /** I2A */
    I2A(List.of(DsaKind.SCALAR), DsaKind.ARRAY),
    /** I2I */
    I2I(List.of(DsaKind.SCALAR), DsaKind.INT),
    /** I2M */
    I2M(List.of(DsaKind.SCALAR), DsaKind.MATRIX),
    /** II2I */
    II2I(List.of(DsaKind.SCALAR, DsaKind.SCALAR), DsaKind.INT),
    /** S2I */
    S2I(List.of(DsaKind.STRING), DsaKind.INT),
    /** S2S */
    S2S(List.of(DsaKind.STRING), DsaKind.STRING),
    /** SI2I */
    SI2I(List.of(DsaKind.STRING, DsaKind.SCALAR), DsaKind.INT),
    /** SS2I */
    SS2I(List.of(DsaKind.STRING, DsaKind.STRING), DsaKind.INT),
    /** SS2S */
    /** string+scalar → string */
    SI2S(List.of(DsaKind.STRING, DsaKind.SCALAR), DsaKind.STRING),
    SS2S(List.of(DsaKind.STRING, DsaKind.STRING), DsaKind.STRING),
    /** SSS2I */
    SSS2I(List.of(DsaKind.STRING, DsaKind.STRING, DsaKind.STRING), DsaKind.INT),;

    public final List<DsaKind> params;
    public final DsaKind ret;

    DsaSig(List<DsaKind> params, DsaKind ret) {
        this.params = List.copyOf(params);
        this.ret = ret;
    }

    public String display(String scalarName) {
        StringBuilder sb = new StringBuilder("solve(");
        for (int i = 0; i < params.size(); i++) {
            if (i > 0) sb.append(", ");
            sb.append(switch (params.get(i)) {
                case ARRAY -> "nums";
                case MATRIX -> "matrix";
                case SCALAR, INT -> i == 0 ? "n" : scalarName;
                case STRING -> i == 0 ? "s" : "t";
            });
        }
        return sb.append(")").toString();
    }

    public String typeSummary(String scalarName) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < params.size(); i++) {
            if (i > 0) sb.append(", ");
            sb.append(switch (params.get(i)) {
                case ARRAY -> "int[] nums";
                case MATRIX -> "int[][] matrix";
                case SCALAR, INT -> "int " + (i == 0 ? "n" : scalarName);
                case STRING -> i == 0 ? "string s" : "string t";
            });
        }
        return sb.append(" → ").append(switch (ret) {
            case INT -> "int";
            case ARRAY -> "int[]";
            case MATRIX -> "int[][]";
            case STRING -> "string";
            default -> "int";
        }).toString();
    }
}
