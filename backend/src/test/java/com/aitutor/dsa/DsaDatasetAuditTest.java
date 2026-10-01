package com.aitutor.dsa;

import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

import java.util.HashSet;
import java.util.List;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Regression guard for the DSA dataset (Phase 13).
 *
 * Validates, for the whole catalog:
 *  - registration count, unique slugs/titles
 *  - metadata presence (statement, constraints, tags, topic)
 *  - every test line (samples + ALL hidden) has exactly one pipe-token per
 *    signature param — the judge-breaking defect class fixed in the audit
 *  - every sample and hidden input evaluates cleanly through the oracle
 */
class DsaDatasetAuditTest {

    @BeforeAll
    static void register() {
        DsaTopics.registerAll();
    }

    @Test
    void catalogRegistersTheFullDataset() {
        List<DsaProblem> all = DsaCatalog.all();
        assertTrue(all.size() >= 328, "expected the full 328-problem dataset, found " + all.size());
        assertEquals(all.size(), DsaCatalog.count());
    }

    @Test
    void slugsAndTitlesAreUnique() {
        Set<String> slugs = new HashSet<>(), titles = new HashSet<>();
        for (DsaProblem p : DsaCatalog.all()) {
            assertTrue(slugs.add(p.slug()), "duplicate slug " + p.slug());
            assertTrue(titles.add(p.title().toLowerCase()), "duplicate title " + p.title());
        }
    }

    @Test
    void everyProblemHasCompleteMetadata() {
        for (DsaProblem p : DsaCatalog.all()) {
            assertNotNull(p.statement(), p.slug() + " statement");
            assertFalse(p.statement().isBlank(), p.slug() + " statement blank");
            assertNotNull(p.constraints(), p.slug() + " constraints");
            assertFalse(p.constraints().isBlank(), p.slug() + " constraints blank");
            assertFalse(p.tags().isEmpty(), p.slug() + " tags");
            assertNotNull(p.topic(), p.slug() + " topic");
            assertTrue(List.of("EASY", "MEDIUM", "HARD").contains(p.difficulty().name()), p.slug() + " difficulty");
        }
    }

    @Test
    void everyTestLineMatchesSignatureTokenCount() {
        for (DsaProblem p : DsaCatalog.all()) {
            int n = p.sig().params.size();
            for (String[] s : p.samples()) {
                assertEquals(n, s[0].split("\\|", -1).length,
                        p.slug() + " sample token count: " + s[0]);
            }
            for (String[] h : p.hiddenTests(Integer.MAX_VALUE)) {
                assertEquals(n, h[0].split("\\|", -1).length,
                        p.slug() + " hidden token count: " + h[0]);
            }
        }
    }

    @Test
    void everySampleAndHiddenInputEvaluatesThroughOracle() {
        for (DsaProblem p : DsaCatalog.all()) {
            for (String[] s : p.samples()) {
                final String line = s[0];
                assertDoesNotThrow(() -> {
                    String exp = p.expectedFor(line);
                    assertNotNull(exp, p.slug() + " sample expected null for " + line);
                }, p.slug() + " sample failed: " + line);
            }
            for (String[] h : p.hiddenTests(Integer.MAX_VALUE)) {
                final String line = h[0];
                assertDoesNotThrow(() -> assertNotNull(p.expectedFor(line),
                        p.slug() + " hidden expected null for " + line),
                        p.slug() + " hidden failed: " + line);
            }
        }
    }

    @Test
    void starterCodeIsAvailableForEverySupportedLanguage() {
        for (DsaProblem p : DsaCatalog.all()) {
            for (DsaLang lang : DsaLang.values()) {
                if (!lang.supports(p.sig())) continue;
                String code = lang.starter(p.sig());
                assertNotNull(code, p.slug() + "/" + lang);
                assertFalse(code.isBlank(), p.slug() + "/" + lang);
            }
        }
    }
}
