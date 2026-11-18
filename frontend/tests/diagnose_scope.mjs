import { chromium } from '@playwright/test';
import fs from 'fs';
import path from 'path';

async function diagnose() {
  const browser = await chromium.launch({ headless: true });
  const viewports = [320, 360, 390, 430, 768, 1440];
  const outDir = '/Users/piyushpandey/Downloads/NovaTutor/docs/stabilization/ui-evidence/additional_scope_diag';
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  for (const w of viewports) {
    const context = await browser.newContext({ viewport: { width: w, height: 800 } });
    const page = await context.newPage();
    await page.route('**/api/**', async (route) => {
      const url = route.request().url();
      if (url.includes('/auth/me')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 1, name: 'Student', email: 'student@novatutor.local', role: 'STUDENT', emailVerified: true, profileComplete: true }) });
      }
      if (url.includes('/community/posts')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([
          { id: 1, author: 'Student A', text: 'How do you approach dynamic programming problems on trees?', createdAt: new Date().toISOString() },
          { id: 2, author: 'Student B', text: 'Check the tree height first, then post-order DFS.', createdAt: new Date().toISOString() }
        ]) });
      }
      if (url.includes('/intelligence/')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ streak: 3, learningEvents: 12, quizzes: 8, studyMinutes: 145, weakAreas: [{ topic: 'Binary Trees', accuracy: 45, reason: 'Frequent off-by-one errors in recursion' }], recommendations: [{ title: 'Revise Recursion', description: 'Practice tree traversals' }] }) });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });
    await page.addInitScript(() => {
      localStorage.setItem('ai_user', JSON.stringify({ id: 1, name: 'Student', role: 'STUDENT', emailVerified: true, profileComplete: true, token: 'valid-token' }));
      localStorage.setItem('nova_page', 'community');
    });

    // 1. Community Weekly Challenges
    await page.goto('http://localhost:5173/#/community', { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    const chalTab = page.locator('.community-tabs button:has-text("Weekly Challenges")');
    if (await chalTab.count() > 0) await chalTab.click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(outDir, `challenges_${w}.png`) });

    const chalData = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('.challenge-card'));
      return cards.map(c => {
        const title = c.querySelector('b')?.innerText;
        const p = c.querySelector('p');
        const strong = c.querySelector('strong');
        const btn = c.querySelector('button');
        const r = c.getBoundingClientRect();
        const pBox = p?.getBoundingClientRect();
        const bBox = c.querySelector('b')?.getBoundingClientRect();
        const btnBox = btn?.getBoundingClientRect();
        const pStyle = p ? window.getComputedStyle(p) : null;
        return {
          title,
          cardWidth: r.width,
          cardHeight: r.height,
          pWidth: pBox?.width,
          pHeight: pBox?.height,
          pWordBreak: pStyle?.wordBreak,
          pOverflowWrap: pStyle?.overflowWrap,
          btnWidth: btnBox?.width,
          btnHeight: btnBox?.height,
          btnTop: btnBox ? btnBox.top - r.top : 0,
          btnLeft: btnBox ? btnBox.left - r.left : 0,
        };
      });
    });

    console.log(`[Challenges ${w}px]:`, JSON.stringify(chalData[0], null, 2));

    // 2. Community Discussion Feed (rules panel and vertical space)
    const feedTab = page.locator('.community-tabs button:has-text("Discussion Feed")');
    if (await feedTab.count() > 0) await feedTab.click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(outDir, `feed_${w}.png`) });

    const feedData = await page.evaluate(() => {
      const main = document.querySelector('.community-main');
      const side = document.querySelector('.community-side');
      const grid = document.querySelector('.community-grid');
      const docHeight = document.documentElement.scrollHeight;
      return {
        docHeight,
        mainHeight: main?.getBoundingClientRect().height,
        sideHeight: side?.getBoundingClientRect().height,
        gridHeight: grid?.getBoundingClientRect().height,
        sideComputedHeight: side ? window.getComputedStyle(side).height : null,
        sideMinHeight: side ? window.getComputedStyle(side).minHeight : null,
      };
    });
    console.log(`[Feed ${w}px]:`, JSON.stringify(feedData, null, 2));

    // 3. Study Room (empty vertical space)
    await page.goto('http://localhost:5173/#/study-room', { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(outDir, `study_room_${w}.png`) });

    const studyData = await page.evaluate(() => {
      const docHeight = document.documentElement.scrollHeight;
      const winHeight = window.innerHeight;
      const main = document.querySelector('main.main-topnav') || document.querySelector('main');
      const lastElem = main?.lastElementChild;
      const lastBox = lastElem?.getBoundingClientRect();
      const mainBox = main?.getBoundingClientRect();
      return {
        winHeight,
        docHeight,
        mainHeight: mainBox?.height,
        mainBottom: mainBox?.bottom,
        lastElemTag: lastElem?.tagName,
        lastElemBottom: lastBox?.bottom,
        emptySpaceBelow: mainBox ? docHeight - (mainBox.top + mainBox.height) : null
      };
    });
    console.log(`[Study Room ${w}px]:`, JSON.stringify(studyData, null, 2));

    // 4. Revision (empty vertical space)
    await page.goto('http://localhost:5173/#/revision', { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(outDir, `revision_${w}.png`) });

    const revData = await page.evaluate(() => {
      const docHeight = document.documentElement.scrollHeight;
      const winHeight = window.innerHeight;
      const main = document.querySelector('main.main-topnav') || document.querySelector('main');
      const mainBox = main?.getBoundingClientRect();
      const hero = document.querySelector('.revision-hero');
      const grid = document.querySelector('.revision-grid');
      return {
        winHeight,
        docHeight,
        mainHeight: mainBox?.height,
        heroHeight: hero?.getBoundingClientRect().height,
        gridHeight: grid?.getBoundingClientRect().height,
      };
    });
    console.log(`[Revision ${w}px]:`, JSON.stringify(revData, null, 2));

    await context.close();
  }
  await browser.close();
}

diagnose().catch(console.error);
