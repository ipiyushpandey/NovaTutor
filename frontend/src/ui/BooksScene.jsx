import React from 'react';

/* BooksScene — the sign-in hero.
 *
 * An original, license-free CSS/SVG composition: a black editorial library
 * where book spines stand on a rear shelf while closed books and loose pages
 * drift slowly through the frame. No external media, no autoplay to be
 * blocked, no layout shift, nothing that can fail to load.
 *
 * Motion contract: every loop animates transform/opacity only, runs 14–34s,
 * and stops completely under prefers-reduced-motion (see books-scene.css).
 * The whole scene is decorative: aria-hidden, pointer-events none.
 */

/* Standing spines leaning together on a shelf, plus a small pile lying flat
   beside them so the silhouette reads as "books", never as a bar chart.
   tone: 1 = mid, 2 = light (page-facing), 3 = deep shadow. */
const SPINES = [
  { w: 17, h: 126, tone: 1, tilt: -3.2 },
  { w: 13, h: 100, tone: 3, tilt: -1.1 },
  { w: 21, h: 138, tone: 2, tilt: -0.4 },
  { w: 15, h: 112, tone: 1, tilt: 0.9 },
  { w: 12, h: 88,  tone: 3, tilt: 2.1 },
  { w: 19, h: 130, tone: 1, tilt: 3.4 },
  { w: 14, h: 104, tone: 2, tilt: 1.6 },
];

export default function BooksScene() {
  return (
    <div className="auth-scene books-scene" aria-hidden="true">
      {/* ---- rear shelf: standing spines, slow horizontal parallax ---- */}
      <div className="bk-layer bk-shelf">
        {SPINES.map((s, i) => (
          <span
            key={i}
            className={'bk-spine t' + s.tone}
            style={{
              '--w': s.w + 'px',
              '--h': s.h + 'px',
              '--tilt': s.tilt + 'deg',
              '--d': (i * 0.4).toFixed(1) + 's',
            }}
          />
        ))}
        <span className="bk-board" />
        <span className="bk-pile"><i /><i /></span>
      </div>

      {/* ---- loose pages drifting through the scene ---- */}
      <div className="bk-layer bk-pages">
        <span className="bk-page bk-page-a" />
        <span className="bk-page bk-page-b" />
      </div>

      {/* ---- floating closed books (depth: blurred + smaller = further) ---- */}
      <div className="bk-layer bk-floaters">
        <span className="bk-book bk-book-a" />
        <span className="bk-book bk-book-b" />
        <span className="bk-book bk-book-c" />
      </div>

      {/* ---- hero: an open book, held up in the light ---- */}
      <div className="bk-layer bk-open">
        <svg viewBox="0 0 260 150" role="presentation" focusable="false">
          <g className="bk-open-pages">
            <path d="M130 26C104 12 66 9 34 20l0 92c32-10 70-7 96 8Z" />
            <path d="M130 26c26-14 64-17 96-6l0 92c-32-10-70-7-96 8Z" />
            <path className="bk-open-gutter" d="M130 26v94" />
            <path className="bk-open-lines" d="M56 44c16-4 34-4 50 1M56 60c16-4 34-4 50 1M56 76c16-4 34-4 50 1" />
            <path className="bk-open-lines" d="M154 45c16-5 34-5 50-1M154 61c16-5 34-5 50-1M154 77c16-5 34-5 50-1" />
          </g>
        </svg>
      </div>

      <div className="auth-scene-inner">
        <div className="scene-brand">
          <span className="scene-mark">N</span>
          <span className="scene-wordmark">NovaTutor · The Learning Workspace</span>
        </div>
        <div className="scene-quote">Little by little,<br />a little becomes a lot.</div>
      </div>
    </div>
  );
}
