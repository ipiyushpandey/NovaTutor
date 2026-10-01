package com.aitutor.dsa;

import java.util.ArrayList;
import java.util.List;

/** Aggregates every topic bank into the catalog. */
public final class DsaTopics {
    private DsaTopics() {}

    private static boolean done = false;

    public static synchronized void registerAll() {
        if (done) return;
        List<DsaProblem> all = new ArrayList<>();
        all.addAll(DsaBankArrays.problems());
        all.addAll(DsaBankStrings.problems());
        all.addAll(DsaBankBinary.problems());
        all.addAll(DsaBankLists.problems());
        all.addAll(DsaBankTrees.problems());
        all.addAll(DsaBankGraphs.problems());
        DsaCatalog.register(all);
        done = true;
    }
}
