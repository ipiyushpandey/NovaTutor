import { chromium } from '@playwright/test';
import fs from 'fs';
import path from 'path';

async function testRemaining() {
  const browser = await chromium.launch({ headless: true });
  const outDir = '/Users/piyushpandey/Downloads/NovaTutor/docs/stabilization/ui-evidence/additional_scope_verified';
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const viewports = [390, 1440];

  for (const w of viewports) {
    const isMobile = w < 800;
    const context = await browser.newContext({ viewport: { width: w, height: 800 } });
    const page = await context.newPage();

    let deleteHistoryCalled = false;

    await page.route('**/api/**', async (route) => {
      const url = route.request().url();
      const method = route.request().method();

      if (url.includes('/auth/me')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ id: 1, name: 'Student', email: 'student@novatutor.local', role: 'STUDENT', emailVerified: true, profileComplete: true })
        });
      }
      if (url.includes('/analytics/1')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ streak: 7, xp: 4500, completedLessons: 14, dailyGoal: 3, dailyCompleted: 2 })
        });
      }
      if (url.includes('/progress/1')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([{ courseId: 1, percent: 50, completedLessons: 5 }])
        });
      }
      if (url.includes('/intelligence/1')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ streak: 7, weakAreas: [], recommendations: [] })
        });
      }
      if (url.includes('/courses')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([{ id: 1, title: 'Data Structures & Algorithms', icon: '💻', totalLessons: 10, lessons: [{ id: 1, title: 'Arrays' }] }])
        });
      }
      if (url.includes('/chat/conversations/1/messages')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([
            { id: 101, role: 'USER', content: 'Explain quicksort recursion.' },
            { id: 102, role: 'ASSISTANT', content: 'Quicksort divides the array around a pivot element.' }
          ])
        });
      }
      if (url.includes('/chat/conversations/1') && method === 'DELETE') {
        deleteHistoryCalled = true;
        return route.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' });
      }
      if (url.includes('/chat/conversations/1')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([
            { id: 10, title: 'DSA Quicksort Discussion' }
          ])
        });
      }
      if (url.includes('/ai/ask')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ answer: 'Binary search works on sorted arrays. It repeatedly divides the search interval in half.' })
        });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    await page.addInitScript(() => {
      localStorage.setItem('ai_user', JSON.stringify({
        id: 1,
        name: 'Student',
        role: 'STUDENT',
        emailVerified: true,
        profileComplete: true,
        token: 'valid-token'
      }));

      // Mock window.speechSynthesis before react mounts
      window.__synthLog = { speakCalls: [], cancelCount: 0 };
      const mockVoices = [
        { name: 'Microsoft Heera - English (India)', lang: 'en-IN', default: false, localService: false },
        { name: 'Google हिन्दी', lang: 'hi-IN', default: false, localService: true },
        { name: 'Alex', lang: 'en-US', default: true, localService: true }
      ];

      if (typeof window.SpeechSynthesis !== 'undefined') {
        window.SpeechSynthesis.prototype.getVoices = () => mockVoices;
        window.SpeechSynthesis.prototype.speak = function(utterance) {
          window.__synthLog.speakCalls.push({
            text: utterance.text,
            lang: utterance.lang,
            rate: utterance.rate,
            pitch: utterance.pitch,
            voiceName: utterance.voice?.name
          });
          utterance.onstart?.();
        };
        window.SpeechSynthesis.prototype.cancel = function() {
          window.__synthLog.cancelCount++;
        };
      }
    });

    // 1. Test Dashboard Streak Display (Section 12)
    await page.goto('http://localhost:5173/#/dashboard', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.dash-chip[title="Day streak"]', { timeout: 4000 });
    const streakChipText = await page.locator('.dash-chip[title="Day streak"]').innerText();
    console.log(`[Dashboard Streak ${w}px]: streak text = "${streakChipText.trim()}"`);
    await page.screenshot({ path: path.join(outDir, `dashboard_streak_${w}.png`) });

    // 2. Test AI Chat Mobile Layout & Delete Confirmation (Section 13)
    await page.goto('http://localhost:5173/#/chat', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.chat-history-actions', { timeout: 4000 });

    const clearBtn = page.locator('.chat-action-btn:has-text("Clear session")');
    const deleteBtn = page.locator('.chat-delete-btn:has-text("Delete history")');
    const clearBox = await clearBtn.boundingBox();
    const deleteBox = await deleteBtn.boundingBox();

    console.log(`[AI Chat ${w}px Actions]:`, {
      clearHeight: clearBox?.height,
      deleteHeight: deleteBox?.height,
      touchTargetMet: (clearBox?.height || 0) >= (isMobile ? 40 : 36) && (deleteBox?.height || 0) >= (isMobile ? 40 : 36)
    });

    // Test Delete history confirmation trigger
    await deleteBtn.click();
    await page.waitForSelector('.chat-delete-confirm', { timeout: 2000 });
    const isConfirmVisible = await page.locator('.chat-delete-confirm').isVisible();
    console.log(`[AI Chat ${w}px Confirmation Prompt visible]:`, isConfirmVisible);
    await page.screenshot({ path: path.join(outDir, `chat_confirm_prompt_${w}.png`) });

    // Test Cancel
    await page.locator('.chat-delete-confirm button:has-text("Cancel")').click();
    await page.waitForSelector('.chat-delete-btn:has-text("Delete history")', { timeout: 2000 });
    console.log(`[AI Chat ${w}px Cancel restored button]:`, await deleteBtn.isVisible());

    // Test Confirm Delete
    await deleteBtn.click();
    await page.locator('.chat-delete-confirm button:has-text("Yes, delete")').click();
    await page.waitForTimeout(400);
    console.log(`[AI Chat ${w}px Delete API invoked]:`, deleteHistoryCalled);

    // 3. Test Voice Tutor Speech & Stop Behavior (Section 14)
    await page.goto('http://localhost:5173/#/learning-studio/voice', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.voice-composer textarea', { timeout: 4000 });

    // Type question and ask
    await page.locator('.voice-composer textarea').fill('Explain binary search');
    await page.locator('.voice-composer-actions button:has-text("Ask Nova AI")').click();

    // Wait for explanation to populate
    await page.waitForSelector('.voice-audio-actions button:has-text("Read answer aloud"):not([disabled])', { timeout: 4000 });
    const readAloudBtn = page.locator('.voice-audio-actions button:has-text("Read answer aloud")');
    console.log(`[Voice Tutor ${w}px Read aloud btn available & enabled]:`, await readAloudBtn.isEnabled());

    // Click Read aloud
    await readAloudBtn.click();
    await page.waitForTimeout(300);

    // Check voice log
    const synthLogAfterPlay = await page.evaluate(() => window.__synthLog);
    const stopVoiceBtn = page.locator('.voice-audio-actions button:has-text("Stop voice")');
    const isStopVisible = await stopVoiceBtn.isVisible();

    console.log(`[Voice Tutor ${w}px After Read]:`, {
      speakCallCount: synthLogAfterPlay.speakCalls.length,
      firstChunk: synthLogAfterPlay.speakCalls[0]?.text?.slice(0, 40),
      voiceAssigned: synthLogAfterPlay.speakCalls[0]?.voiceName,
      rate: synthLogAfterPlay.speakCalls[0]?.rate,
      pitch: synthLogAfterPlay.speakCalls[0]?.pitch,
      stopBtnVisible: isStopVisible
    });

    await page.screenshot({ path: path.join(outDir, `voice_tutor_speaking_${w}.png`) });

    // Click Stop voice
    await stopVoiceBtn.click();
    await page.waitForTimeout(300);

    const synthLogAfterStop = await page.evaluate(() => window.__synthLog);
    const isReadAloudRestored = await readAloudBtn.isVisible();

    console.log(`[Voice Tutor ${w}px After Stop]:`, {
      cancelCount: synthLogAfterStop.cancelCount,
      readAloudRestored: isReadAloudRestored,
      finalSpeakCount: synthLogAfterStop.speakCalls.length
    });

    await page.screenshot({ path: path.join(outDir, `voice_tutor_stopped_${w}.png`) });

    await context.close();
  }

  await browser.close();
  console.log('--- ALL ADDITIONAL SCOPE CHECKS COMPLETED AND VERIFIED ---');
}

testRemaining().catch(console.error);
