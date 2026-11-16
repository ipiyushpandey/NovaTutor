package com.aitutor.dsa;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

/**
 * The comparison rules decide whether a student is accepted. These tests pin
 * the behaviour that previously failed correct submissions and accepted
 * incorrect ones.
 */
class DsaOutputComparisonTest {

    @Test
    void acceptsIdenticalOutput() {
        assertTrue(DsaJudgeService.outputsMatch("5", "5"));
        assertTrue(DsaJudgeService.outputsMatch("[1,2,3]", "[1,2,3]"));
    }

    @Test
    void acceptsSpacingDifferencesInsideStructuredAnswers() {
        assertTrue(DsaJudgeService.outputsMatch("[1, 2, 3]", "[1,2,3]"), "array spacing must not matter");
        assertTrue(DsaJudgeService.outputsMatch("[1, 2]", "[1,2]"), "array spacing must not matter");
        assertTrue(DsaJudgeService.outputsMatch("[1,2; 3,4]", "[1,2;3,4]"), "matrix spacing must not matter");
        assertTrue(DsaJudgeService.outputsMatch("[ 1, 2 ; 3, 4 ]", "[1,2;3,4]"), "matrix spacing must not matter");
        assertTrue(DsaJudgeService.outputsMatch(" 42 ", "42"), "surrounding whitespace must not matter");
        assertTrue(DsaJudgeService.outputsMatch("-7", "-7"), "negative numbers must compare correctly");
    }

    @Test
    void rejectsGenuinelyWrongStructuredOutput() {
        assertFalse(DsaJudgeService.outputsMatch("[1,2,4]", "[1,2,3]"));
        assertFalse(DsaJudgeService.outputsMatch("[2,1]", "[1,2]"), "array order is significant");
        assertFalse(DsaJudgeService.outputsMatch("6", "5"));
        assertFalse(DsaJudgeService.outputsMatch("-5", "5"));
    }

    /**
     * Regression: the previous implementation deleted every whitespace
     * character, so "12" matched "1 2". Token boundaries must survive.
     */
    @Test
    void neverTreatsJoinedTokensAsEqual() {
        assertFalse(DsaJudgeService.outputsMatch("12", "1 2"));
        assertFalse(DsaJudgeService.outputsMatch("1 2", "12"));
    }

    @Test
    void comparesFreeTextWithoutIgnoringSpaces() {
        assertTrue(DsaJudgeService.outputsMatch("hello world", "hello world"));
        assertTrue(DsaJudgeService.outputsMatch("hello   world ", "hello world"), "repeated spaces collapse");
        assertFalse(DsaJudgeService.outputsMatch("helloworld", "hello world"), "missing space is a different answer");
        assertFalse(DsaJudgeService.outputsMatch("Hello World", "hello world"), "case is significant");
    }

    @Test
    void rejectsEmptyVersusNonEmpty() {
        assertFalse(DsaJudgeService.outputsMatch("", "5"));
        assertFalse(DsaJudgeService.outputsMatch("5", ""));
        assertTrue(DsaJudgeService.outputsMatch("", ""));
    }
}
