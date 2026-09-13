/* ==========================================================================
   AYRA — landing page behaviour
   No dependencies. Everything degrades gracefully without JS.
   ========================================================================== */
(function () {
  'use strict';

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ========================================================================
     Frame scheduler

     Everything scroll-driven on this page (nav state, parallax, the pinned
     intro sequence) shares ONE rAF loop rather than each owning its own
     scroll listener and ticking flag. Lenis needs a continuous rAF anyway, so
     when it is running the loop drives lenis.raf() first and the page's own
     frame tasks immediately after — they then read a scroll position Lenis
     has already settled for this frame, which is what keeps the parallax in
     lockstep with the smoothing instead of a frame behind it.

     Without Lenis (reduced motion, or the CDN failing) the same tasks are
     driven by a scroll listener with the usual one-rAF-per-scroll guard.
     ======================================================================== */
  var frameTasks   = [];
  var measureTasks = [];
  var lenis        = null;
  var ticking      = false;
  var lastY        = null;

  function onFrame(fn)   { frameTasks.push(fn); }
  function onMeasure(fn) { measureTasks.push(fn); }

  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

  /* How far an element has travelled across the viewport, -1 (just entering
     from below) through 0 (centred) to +1 (just left the top). The parallax
     layers and the headline scrub both run off this. */
  function crossing(rect, vh) {
    var span = vh / 2 + rect.height / 2;
    if (span <= 0) return 0;
    var t = (vh / 2 - (rect.top + rect.height / 2)) / span;
    return t < -1 ? -1 : t > 1 ? 1 : t;
  }

  function runFrame() {
    ticking = false;

    // Idle guard: with a continuous loop this would otherwise re-read layout
    // 60x a second while nothing moves. Measuring forces the next pass.
    var y = window.scrollY;
    if (y === lastY) return;
    lastY = y;

    for (var i = 0; i < frameTasks.length; i++) frameTasks[i]();
  }

  function runMeasure() {
    lastY = null;
    for (var i = 0; i < measureTasks.length; i++) measureTasks[i]();
  }

  function requestFrame() {
    if (lenis || ticking) return;   // the continuous loop already covers it
    ticking = true;
    window.requestAnimationFrame(runFrame);
  }

  /* ------------------------------------------------------------------------
     1. Nav — auto-hide by scroll direction, section-aware ink

        Visibility: compares this frame's scrollY to last frame's, inside the
        shared loop rather than a second one. Direction changes under
        DEAD_ZONE px are ignored so trackpad jitter can't flicker the bar, and
        prevY is only advanced once a change is acted on — so a slow drag
        still accumulates to the threshold instead of being discarded.

        Two overrides beat direction: the top of the page always shows, and
        anywhere in the footer always hides (the footer carries its own menu,
        so scrolling up inside it must not bring the bar back).

        Ink: the nav has no fill at any scroll position now, so contrast comes
        entirely from the ink. A 1px-tall IntersectionObserver band sits on the
        nav's own centre line; whichever section crosses it hands over its
        data-nav-theme.

        Menu: below 1025px the link row becomes a sheet behind a burger button.
        It is handled here, not separately, because it and the auto-hide share
        state — an open sheet pins the bar.
     ------------------------------------------------------------------------ */
  (function navState() {
    var nav = document.getElementById('nav');
    if (!nav) return;

    var DEAD_ZONE = 5;   // px of travel before a direction change counts
    var TOP_ZONE  = 8;   // this close to the top, always visible

    var prevY    = window.scrollY;
    var hidden   = false;
    var inFooter = false;

    function setHidden(next) {
      /* The menu sheet hangs off the bar rather than off the viewport (it has
         to — see the CSS), so sliding the bar away would take an open menu
         with it. While it is open the bar is pinned. */
      if (next && nav.classList.contains('nav--menu-open')) return;
      if (next === hidden) return;
      hidden = next;
      nav.classList.toggle('nav--hidden', next);
    }

    function update() {
      var y = window.scrollY;

      if (inFooter)      { setHidden(true);  prevY = y; return; }
      if (y <= TOP_ZONE) { setHidden(false); prevY = y; return; }

      var delta = y - prevY;
      if (Math.abs(delta) < DEAD_ZONE) return;   // jitter — leave prevY alone

      prevY = y;
      setHidden(delta > 0);
    }

    /* Reduced motion: no hide/reveal at all. The bar simply stays put — the
       CSS transition is already neutralised, and animating it open and shut on
       every direction change is exactly the motion to avoid. */
    if (!reduceMotion) onFrame(update);

    /* --- burger menu (tablet and phone) ---
       Lives in here rather than in a module of its own because it and the
       auto-hide are the same piece of state: opening the sheet has to pin the
       bar, and setHidden above has to know not to fight it.

       aria-expanded on the button is the source of truth for assistive tech
       and for the CSS that draws the cross; .nav--menu-open is only a styling
       and coordination hook. */
    var burger = document.getElementById('nav-burger');
    var menu   = document.getElementById('nav-menu');

    if (burger && menu) {
      var links    = [].slice.call(menu.querySelectorAll('.nav__link'));
      var menuOpen = false;

      /* Everything outside the bar. Marking it inert while the sheet is open
         IS the focus trap — Tab cannot reach it and screen readers skip it —
         which is why there is no hand-rolled wrap-around here. Browsers
         without inert simply get no trap; nothing breaks. */
      var behind = [document.getElementById('main'),
                    document.querySelector('.footer')];

      links.forEach(function (link, i) { link.style.setProperty('--i', i); });

      function setMenu(open, restoreFocus) {
        if (open === menuOpen) return;
        menuOpen = open;

        nav.classList.toggle('nav--menu-open', open);
        document.documentElement.classList.toggle('is-menu-open', open);
        burger.setAttribute('aria-expanded', open ? 'true' : 'false');
        burger.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
        behind.forEach(function (el) { if (el) el.inert = open; });

        /* The CSS lock stops native and touch scrolling; this stops Lenis,
           which runs its own loop and would otherwise keep animating under
           the sheet. */
        if (lenis) { if (open) lenis.stop(); else lenis.start(); }

        if (open) {
          setHidden(false);
          if (links[0]) links[0].focus();
        } else if (restoreFocus !== false) {
          burger.focus();
        }
      }

      burger.addEventListener('click', function () { setMenu(!menuOpen); });

      document.addEventListener('keydown', function (event) {
        if (menuOpen && event.key === 'Escape') setMenu(false);
      });

      /* A link closes the sheet and then anchors() scrolls to the section and
         puts focus on it. Passing restoreFocus:false keeps this handler from
         yanking focus back to the button a moment later and undoing that. */
      links.forEach(function (link) {
        link.addEventListener('click', function () { setMenu(false, false); });
      });

      /* Resizing up to the desktop row while the sheet is open would leave the
         page inert and scroll-locked behind a panel that display:none has just
         taken away — with no button left to close it. */
      var wide = window.matchMedia('(min-width: 1025px)');
      var onWide = function (event) { if (event.matches) setMenu(false, false); };
      if (wide.addEventListener) wide.addEventListener('change', onWide);
      else if (wide.addListener) wide.addListener(onWide);
    }

    if (!('IntersectionObserver' in window)) return;

    /* --- force-hide over the footer --- */
    var footer = document.querySelector('.footer');
    if (footer && !reduceMotion) {
      new IntersectionObserver(function (entries) {
        inFooter = entries[0].isIntersecting;

        if (inFooter) { setHidden(true); return; }

        /* Leaving the footer only happens by scrolling up, so reveal outright
           rather than deferring to update(). While the footer was in view
           prevY was being kept in step with y every frame, so at this moment
           delta is ~0 — under the dead zone — and update() would decline to
           act, leaving the bar stuck hidden until the user scrolled another
           5px. Reset prevY so the next delta is measured from here. */
        prevY = window.scrollY;
        setHidden(false);
      }, { threshold: 0 }).observe(footer);
    }

    /* --- section-aware ink ---
       rootMargin can't be changed on a live observer, and it depends on the
       viewport height and nav height, so the observer is rebuilt on resize. */
    var themed = document.querySelectorAll('[data-nav-theme]');
    var themeIO = null;

    function applyTheme(theme) {
      nav.classList.toggle('nav--on-dark',  theme === 'dark');
      nav.classList.toggle('nav--on-light', theme !== 'dark');
    }

    function watchThemes() {
      if (themeIO) themeIO.disconnect();

      var mid = nav.offsetHeight / 2;
      var vh  = window.innerHeight;
      if (vh <= mid + 1) return;

      themeIO = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          applyTheme(entry.target.getAttribute('data-nav-theme'));
        });
      }, {
        // Collapses the root to a 1px band on the nav's centre line.
        rootMargin: '-' + mid + 'px 0px -' + (vh - mid - 1) + 'px 0px',
        threshold: 0
      });

      themed.forEach(function (el) { themeIO.observe(el); });
    }

    applyTheme('light');
    watchThemes();
    onMeasure(watchThemes);
  })();

  /* ------------------------------------------------------------------------
     2. Scroll reveal — fade + rise, staggered via data-delay
     ------------------------------------------------------------------------ */
  (function scrollReveal() {
    var items = document.querySelectorAll('.reveal');
    if (!items.length) return;

    // No IntersectionObserver: just show everything.
    // Reduced motion still gets the entrance — CSS reduces it to a crossfade
    // with no travel, which is the part that actually causes discomfort.
    if (!('IntersectionObserver' in window)) {
      items.forEach(function (el) { el.classList.add('is-in'); });
      return;
    }

    items.forEach(function (el) {
      var d = el.getAttribute('data-delay');
      if (d) el.style.setProperty('--d', d);
    });

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-in');
        io.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0.08 });

    items.forEach(function (el) { io.observe(el); });
  })();

  /* ------------------------------------------------------------------------
     3. Parallax — background layers drift slower than the text above them

        Each [data-parallax] element declares its amplitude in px. As the
        element crosses the viewport its centre distance from the viewport
        centre is normalised to -1..1 and multiplied by that amplitude, so the
        layer travels a bounded, predictable distance instead of accelerating
        away on long pages.

        Amplitude, not raw scroll multiplication, is what keeps this subtle:
        a 30px layer over a ~1000px crossing works out to roughly 0.4x the
        speed of the text beside it.

        Reads and writes both happen inside rAF; the scroll listener only
        raises a flag. Layers outside the viewport are skipped entirely.
     ------------------------------------------------------------------------ */
  (function parallax() {
    if (reduceMotion) return;

    /* data-parallax is the amplitude, but it is one value for every width, and
       what a layer can travel depends on the frame it travels inside — the
       Single Petal photo has 112px of overhang and a tall frame on desktop and
       neither at tablet. --px-amp lets a breakpoint override the attribute, so
       the amplitude can be tuned where the geometry actually differs. Resolved
       on resize rather than per frame: reading a computed style every frame for
       every layer would force a style recalc the rest of this module avoids. */
    function readAmp(el) {
      var css = parseFloat(getComputedStyle(el).getPropertyValue('--px-amp'));
      if (css > 0) return css;
      return parseFloat(el.getAttribute('data-parallax')) || 30;
    }

    var layers = [].map.call(document.querySelectorAll('[data-parallax]'),
      function (el) {
        return { el: el, amp: readAmp(el) };
      });
    if (!layers.length) return;

    onMeasure(function () {
      for (var i = 0; i < layers.length; i++) layers[i].amp = readAmp(layers[i].el);
    });

    function frame() {
      var vh = window.innerHeight;

      for (var i = 0; i < layers.length; i++) {
        var layer = layers[i];
        var rect  = layer.el.getBoundingClientRect();

        // Nothing to do for layers well outside the viewport.
        if (rect.bottom < -120 || rect.top > vh + 120) continue;

        layer.el.style.setProperty(
          '--px-shift', (crossing(rect, vh) * layer.amp).toFixed(2) + 'px');
      }
    }

    onFrame(frame);
  })();

  /* ------------------------------------------------------------------------
     4. Headline scrub — words sharpen out of blur, tied to scroll position

        Not a play-once entrance: every frame recomputes each word's blur from
        the section's current scroll progress, so scrolling back up re-blurs
        them in reverse through exactly the same values.

        Words are wrapped on load rather than in the markup, walking child
        nodes so the <br> inside each headline survives and the whitespace
        between words is kept as real text nodes (otherwise the line stops
        wrapping).

        Runs in the shared frame loop, and skips any headline that is not
        within NEAR px of the viewport.
     ------------------------------------------------------------------------ */
  (function headlineScrub() {
    if (reduceMotion) return;   // headlines just render normally

    var MAX_BLUR = 12;    // px, fully blurred
    var NEAR     = 200;   // px outside the viewport still worth updating

    /* The stagger is normalised to the word count rather than being a fixed
       step per word. That matters: a full-height section's resting position —
       the one the reader actually stops at — is progress 0.5, because progress
       runs 0 as the section's top enters the viewport bottom to 1 as its
       bottom clears the top. A fixed per-word step pushes the last word's
       finish line past 0.5 as soon as a headline has five words, so it can
       only resolve once the section is already leaving. Anchoring the whole
       run between START and END keeps every headline, at any length, fully
       clear before it settles. */
    var START   = 0.06;   // first word begins sharpening
    var END     = 0.44;   // last word fully clear, comfortably before 0.5
    var OVERLAP = 2;      // word slots one word's sharpen spans, so it waves

    /* Wrap each word, leaving <br> and the spaces between words intact. */
    function splitWords(el) {
      var words = [];
      Array.prototype.slice.call(el.childNodes).forEach(function (node) {
        if (node.nodeType !== 3) return;                  // element, e.g. <br>
        var frag = document.createDocumentFragment();
        node.nodeValue.split(/(\s+)/).forEach(function (chunk) {
          if (!chunk) return;
          if (/^\s+$/.test(chunk)) {
            frag.appendChild(document.createTextNode(chunk));
            return;
          }
          var span = document.createElement('span');
          span.className = 'word';
          span.textContent = chunk;
          frag.appendChild(span);
          words.push(span);
        });
        el.replaceChild(frag, node);
      });
      return words;
    }

    var heads = [];
    document.querySelectorAll('[data-blur-words]').forEach(function (el) {
      var section = el.closest('section');
      if (!section) return;
      var win = (el.getAttribute('data-blur-window') || '').split(/\s+/).map(parseFloat);
      heads.push({
        el: el,
        section: section,
        // A pinned section's progress is its scroll-through, not its crossing.
        pin: section.querySelector('.intro__pin'),
        words: splitWords(el),
        from: isFinite(win[0]) ? win[0] : 0,
        to:   isFinite(win[1]) ? win[1] : 1
      });
    });
    if (!heads.length) return;

    function sectionProgress(head, vh) {
      var rect = head.section.getBoundingClientRect();

      if (head.pin) {
        // The headline is inside a sticky stage, so its own rect barely moves
        // while pinned — track how far the section has scrolled instead. The
        // pin covers two phases, and data-blur-window is written in sequence
        // terms, so divide by the sequence's share to match.
        var travel = head.section.offsetHeight - head.pin.clientHeight;
        if (travel <= 0) return 0;

        var cs      = getComputedStyle(head.section);
        var seqVh   = parseFloat(cs.getPropertyValue('--seq-vh'))   || 0;
        var aboutVh = parseFloat(cs.getPropertyValue('--about-vh')) || 0;
        var seqEnd  = seqVh && (seqVh + aboutVh - 100) > 0
          ? (seqVh - 100) / (seqVh + aboutVh - 100)
          : 1;

        return clamp01(-rect.top / travel / seqEnd);
      }
      // 0 as the section's top reaches the viewport bottom, 1 as its bottom
      // clears the top.
      return clamp01((vh - rect.top) / (vh + rect.height));
    }

    function paint(words, w) {
      var slot    = (END - START) / words.length;
      var sharpen = slot * OVERLAP;

      for (var i = 0; i < words.length; i++) {
        var done = START + slot * (i + 1);
        var t    = clamp01((w - (done - sharpen)) / sharpen);
        var span = words[i];

        if (t >= 1) {
          // Drop the filter rather than painting blur(0) — a live filter on
          // every word is the expensive part.
          if (span.style.filter !== 'none') {
            span.style.filter = 'none';
            span.style.opacity = '1';
          }
        } else {
          span.style.filter = 'blur(' + ((1 - t) * MAX_BLUR).toFixed(2) + 'px)';
          span.style.opacity = t.toFixed(3);
        }
      }
    }

    onFrame(function () {
      var vh = window.innerHeight;
      for (var i = 0; i < heads.length; i++) {
        var head = heads[i];
        var rect = head.el.getBoundingClientRect();
        if (rect.bottom < -NEAR || rect.top > vh + NEAR) continue;

        var p = sectionProgress(head, vh);
        var w = head.to > head.from
          ? clamp01((p - head.from) / (head.to - head.from))
          : p;

        paint(head.words, w);
      }
    });
  })();

  /* ------------------------------------------------------------------------
     5. Managed videos — hero backdrop, About portrait, and the two ambient
        echoes (Venn section, footer)
        Autoplay is declarative; this only handles the cases the attributes
        can't: reduced-motion, a browser that blocks autoplay, and pausing
        while the element is off screen so we're not decoding frames for
        nothing.

        Every one gets identical treatment, so this runs once per element
        rather than being written out repeatedly. The off-screen pause matters
        most for the About portrait, which is on screen at full size, but it is
        what keeps four videos on one page from all decoding at once.
     ------------------------------------------------------------------------ */
  Array.prototype.forEach.call(
    // Every managed video declares data-src-hd, so that attribute is the hook
    // rather than a class list that has to grow each time one is added.
    document.querySelectorAll('video[data-src-hd]'),
  function introVideo(video) {

    /* Reduced motion: the poster stands in entirely. Dropping the <source>
       children and reloading is what actually cancels the download — removing
       the src attribute alone did nothing here, because neither video sets
       one; both declare their file in a <source> child. That was harmless
       when this only ran on the backdrop, but the card's portrait is 1.5MB
       nobody in this branch will ever see. */
    if (reduceMotion) {
      video.pause();
      video.removeAttribute('autoplay');
      video.removeAttribute('src');
      Array.prototype.forEach.call(video.querySelectorAll('source'), function (el) {
        el.remove();
      });
      video.load();
      return;
    }

    // Some browsers reject autoplay until the element is known to be muted.
    video.muted = true;

    // The markup loads the 720p file. Swap up to 1080p only when the screen is
    // big enough to show the difference and the connection isn't metered or
    // flagged save-data. Only metadata has been fetched at this point, so the
    // switch costs almost nothing.
    (function upgradeSource() {
      var hd = video.getAttribute('data-src-hd');
      if (!hd) return;
      if (window.innerWidth * (window.devicePixelRatio || 1) < 1280) return;

      var link = navigator.connection;
      if (link) {
        if (link.saveData) return;
        if (/(^|-)2g$/.test(link.effectiveType || '')) return;
      }

      video.querySelector('source').remove();
      video.src = hd;
      video.load();
    })();

    var play = function () {
      if (!video.paused) return;
      var attempt = video.play();
      if (attempt && attempt.catch) {
        // Blocked (e.g. iOS Low Power Mode) — the poster stays up, which is fine.
        attempt.catch(function () {});
      }
    };

    // load() above discards any play() already in flight, so also start on
    // canplay — that's the event the swapped-in file will fire.
    video.addEventListener('canplay', play);
    play();

    // Browsers pause background tabs and don't always resume on return.
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) play();
    });

    if (!('IntersectionObserver' in window)) return;

    new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) play();
        else video.pause();
      });
    }, { threshold: 0.01 }).observe(video);
  });

  /* ------------------------------------------------------------------------
     6. Intro sequence — hero morphing into the About card

        One progress value (0 → 1) is read from the pinned section's position
        and fanned out to CSS custom properties, once per animation frame. The
        scroll listener only raises a flag; every read and write happens inside
        rAF, so there is no layout thrash and no work is done for scroll events
        the browser will never paint.

        The CSS already declares the end state, so if this never runs the stage
        simply shows the finished About composition.
     ------------------------------------------------------------------------ */
  (function introSequence() {
    var intro = document.querySelector('.intro');
    if (!intro || reduceMotion) return;

    var pin   = intro.querySelector('.intro__pin');
    var stage = intro.querySelector('.intro__stage');
    var mark  = intro.querySelector('.intro__wordmark');
    var tag   = intro.querySelector('.intro__tagline');
    var wordL = intro.querySelector('.intro__word--l');
    var wordR = intro.querySelector('.intro__word--r');
    if (!pin || !stage || !mark || !tag || !wordL || !wordR) return;

    var stacked = window.matchMedia('(max-width: 720px)');
    /* The card keeps its two columns here, but not its 1.8:1 letterbox — see
       panelH below. */
    var tablet  = window.matchMedia('(min-width: 721px) and (max-width: 1024px)');

    /* Choreography. Each entry is a [start, end] window on p, so the beats
       read top to bottom and the overlaps are visible at a glance. */
    var T = {
      chrome:  [0.010, 0.120],   // scroll cue steps aside
      split:   [0.080, 0.420],   // tagline halves part, opening the gap
      lift:    [0.080, 0.420],   // wordmark rises to make room
      panelIn: [0.240, 0.520],   // portrait scales up into that gap
      expand:  [0.560, 0.880],   // panel grows out to full width, photo bleeding
      markOut: [0.560, 0.700],   // wordmark and tagline leave
      resolve: [0.800, 0.980],   // only then does the photo recede to one side
      copyIn:  [0.860, 1.000]    // About column arrives in the space it left
    };

    var clamp = clamp01;
    function seg(p, w) { return clamp((p - w[0]) / (w[1] - w[0])); }
    function smooth(t) { return t * t * (3 - 2 * t); }
    function outCubic(t) { return 1 - Math.pow(1 - t, 3); }
    function lerp(a, b, t) { return a + (b - a) * t; }

    /* --- geometry, recomputed only on resize --------------------------- */
    var G = {};

    function measure() {
      var vw = document.documentElement.clientWidth;
      var vh = pin.clientHeight || window.innerHeight;
      var isStacked = stacked.matches;

      // A 14.5vw opening card would be a postage stamp on a phone.
      var smallW = isStacked
        ? Math.max(118, Math.min(vw * 0.34, 200))
        : Math.max(150, Math.min(vw * 0.145, 290));

      /* The panel is the About card, so it fills the section exactly the way
         every other block does: full width minus the section margin.

         --section-margin is a clamp(), and custom properties are substituted
         rather than resolved, so parseFloat on the token would give NaN. Read
         the stage's own resolved padding instead — same value, and it stays
         correct if the token is ever changed. */
      var stageStyle = getComputedStyle(stage);
      var inset = parseFloat(stageStyle.paddingLeft) +
                  parseFloat(stageStyle.paddingRight);

      var panelW = Math.max(0, stage.clientWidth - inset);

      /* The same cap .container applies to every other section, read from the
         token rather than repeated — this module writes --seq-panel-w as a px
         value every frame, so a cap expressed only in CSS would be overwritten
         the moment the sequence ran. --section-max is a plain length, so
         parseFloat is safe here where it is not for the clamped margin. */
      var maxW = parseFloat(getComputedStyle(intro).getPropertyValue('--section-max'));
      if (maxW > 0) panelW = Math.min(panelW, maxW);

      /* 0.556 is a 1.8:1 letterbox, which is the card's designed proportion —
         but the panel scales with the viewport while the type inside it is on
         a clamp, so as the card narrows the copy takes an ever larger share of
         it: 73% of the panel's height at 1024, and 94% at 768, which leaves
         11px of slack top and bottom and reads as no padding at all. Tablet
         therefore gets a taller card (1.43:1) so the copy keeps real breathing
         room. The vh cap still wins wherever it is the tighter of the two, so
         this can never push the card past the section. */
      var panelH = isStacked
        ? Math.min(vh * 0.86, panelW * 1.95)
        : Math.min(vh * 0.78, panelW * (tablet.matches ? 0.70 : 0.556));

      /* Fraction of the pin's travel the hero-to-card sequence occupies.
         Both numbers live in CSS so the timing and the section height can
         never drift apart. */
      var seqVh   = parseFloat(getComputedStyle(intro).getPropertyValue('--seq-vh')) || 300;
      var aboutVh = parseFloat(getComputedStyle(intro).getPropertyValue('--about-vh')) || 0;
      var seqEnd  = (seqVh + aboutVh - 100) > 0
        ? (seqVh - 100) / (seqVh + aboutVh - 100)
        : 1;

      G = {
        vw: vw,
        vh: vh,
        seqEnd: seqEnd,
        stacked: isStacked,
        smallW: smallW,
        smallH: smallW * 1.25,
        panelW: panelW,
        panelH: panelH,
        photoEnd: isStacked ? 0.48 : 0.58,
        maskEnd: isStacked ? 42 : 30
      };

      /* Zero the transforms so the resting layout can be read, then derive
         every travel from real positions rather than guessed viewport units.
         One forced layout, on resize only. */
      ['--seq-word-l', '--seq-word-r', '--seq-mark-y', '--seq-word-y']
        .forEach(function (k) { intro.style.setProperty(k, '0px'); });

      /* Everything below is expressed relative to the pin's own box, never to
         the viewport, so the result is the same whether the pin is stuck,
         still approaching, or already released. */
      var box     = pin.getBoundingClientRect();
      var centreX = box.left + box.width / 2;

      var markBox = mark.getBoundingClientRect();
      var tagBox  = tag.getBoundingClientRect();
      var rL      = wordL.getBoundingClientRect();
      var rR      = wordR.getBoundingClientRect();

      var markBottom = markBox.bottom - box.top;
      var tagMid     = tagBox.top - box.top + tagBox.height / 2;

      // Where the panel sits while the tagline is parted around it.
      var panelMid = box.height / 2 + vh * 0.055;

      // The tagline drops to the panel's centre line...
      G.wordDY = panelMid - tagMid;

      // ...and the wordmark rises to clear the panel's top edge.
      var gap = Math.max(20, vh * 0.045);
      G.markDY = Math.min(0, (panelMid - G.smallH / 2 - gap) - markBottom);

      /* The two halves are different widths, so moving both by the same amount
         leaves lopsided gaps. Give each its own travel, measured from its own
         resting inner edge. */
      var margin = isStacked ? Math.max(22, vw * 0.03) : Math.max(40, vw * 0.035);
      var clear  = smallW / 2 + margin;

      G.travelL = Math.max(0, clear - (centreX - rL.right));
      G.travelR = Math.max(0, clear - (rR.left - centreX));

      // Capped so neither word can slide off the edge of a narrow screen.
      G.travelL = Math.min(G.travelL, Math.max(0, rL.left - 14));
      G.travelR = Math.min(G.travelR, Math.max(0, vw - 14 - rR.right));
    }

    /* --- the frame ----------------------------------------------------- */
    function apply(p) {
      var s = intro.style;

      var eSplit = smooth(seg(p, T.split));
      var eLift  = smooth(seg(p, T.lift));
      var eIn    = outCubic(seg(p, T.panelIn));
      var eGrow  = smooth(seg(p, T.expand));
      var eRes   = smooth(seg(p, T.resolve));
      var eCopy  = outCubic(seg(p, T.copyIn));

      s.setProperty('--seq-cue-o',  (1 - seg(p, T.chrome)).toFixed(3));
      s.setProperty('--seq-mark-o', (1 - seg(p, T.markOut)).toFixed(3));
      s.setProperty('--seq-mark-y', (G.markDY * eLift).toFixed(2) + 'px');
      s.setProperty('--seq-word-l', (G.travelL * eSplit).toFixed(2) + 'px');
      s.setProperty('--seq-word-r', (G.travelR * eSplit).toFixed(2) + 'px');
      s.setProperty('--seq-word-y', (G.wordDY * eSplit).toFixed(2) + 'px');

      var w = lerp(G.smallW, G.panelW, eGrow);
      var h = lerp(G.smallH, G.panelH, eGrow);

      s.setProperty('--seq-panel-o', eIn.toFixed(3));
      s.setProperty('--seq-panel-s', lerp(0.62, 1, eIn).toFixed(4));
      s.setProperty('--seq-panel-w', w.toFixed(1) + 'px');
      s.setProperty('--seq-panel-h', h.toFixed(1) + 'px');
      s.setProperty('--seq-panel-r', lerp(20, 40, eGrow).toFixed(1) + 'px');
      s.setProperty('--seq-panel-y', lerp(G.vh * 0.055, 0, eGrow).toFixed(2) + 'px');

      // The photo keeps the whole panel right through the growth, then pulls
      // to one side and dissolves into the gradient behind it.
      var keep = lerp(1, G.photoEnd, eRes);
      if (G.stacked) {
        s.setProperty('--seq-photo-w', w.toFixed(1) + 'px');
        s.setProperty('--seq-photo-h', (h * keep).toFixed(1) + 'px');
      } else {
        s.setProperty('--seq-photo-w', (w * keep).toFixed(1) + 'px');
        s.setProperty('--seq-photo-h', h.toFixed(1) + 'px');
      }
      s.setProperty('--seq-mask', (G.maskEnd * eRes).toFixed(1) + '%');

      s.setProperty('--seq-copy-w', (w * (G.stacked ? 1 : 0.58)).toFixed(1) + 'px');
      s.setProperty('--seq-copy-o', eCopy.toFixed(3));
      s.setProperty('--seq-copy-y', lerp(26, 0, eCopy).toFixed(1) + 'px');
    }

    function frame() {
      var travel = intro.offsetHeight - pin.clientHeight;
      var raw = travel > 0 ? clamp(-intro.getBoundingClientRect().top / travel) : 1;
      // The pin now covers two phases; this one owns the first, so its 0..1 is
      // remapped onto the leading slice rather than the whole scroll range.
      apply(G.seqEnd > 0 ? clamp(raw / G.seqEnd) : raw);
    }

    onMeasure(measure);
    onFrame(frame);

    /* Both travels are derived from rendered geometry, so re-measure whenever
       that geometry can still change — including when the layout switches
       between the stacked and side-by-side arrangements. */
    if (tablet.addEventListener) {
      tablet.addEventListener('change', function () { runMeasure(); requestFrame(); });
    }
    if (stacked.addEventListener) {
      stacked.addEventListener('change', function () { runMeasure(); requestFrame(); });
    }
  })();

  /* ------------------------------------------------------------------------
     7. Venn sequence — draw in, hold, clear out

        One pinned wrapper, one progress value, three phases. Progress comes
        from the wrapper's own scroll distance, NOT from any element's live
        rect: inside a sticky stage every child's rect stops changing the
        moment the pin engages, so a rect-driven value freezes mid-animation.
        The wrapper's document offset is resolved once per resize, and each
        frame only reads window.scrollY.

        Every element's window is declared in PARTS below rather than computed,
        so the whole choreography is readable in one place and retiming is a
        matter of editing two numbers.
     ------------------------------------------------------------------------ */
  (function vennSequence() {
    var wrap = document.querySelector('.venn');
    if (!wrap) return;

    var pin = wrap.querySelector('.venn__pin');
    var svg = wrap.querySelector('.venn__svg');
    if (!pin || !svg) return;

    /* Reduced motion: the CSS has already dropped the pin and shown every
       part. Touching inline styles here would only fight it. */
    if (reduceMotion) return;

    var NS = 'http://www.w3.org/2000/svg';
    var MAX_BLUR = 6;      // user units — the titles are 28.83 units tall
    var SETTLE   = 7;      // user units each word rises as it sharpens

    /* Batches, a hold, then one shared exit. Opacity only apart from the two
       stroke circles, which draw themselves on.

       id, fade-in from, fade-in to. `null` means the group itself is not faded
       — its words carry the entrance, and fading both would double it up. */
    var EXIT_FROM = 0.88, EXIT_TO = 1.00;
    var PARTS = [
      // 1 — strokes draw on while the fills come up underneath them
      ['CircleGradientStokeLeft',  0.000, 0.180],
      ['CircleGradientStokeRight', 0.000, 0.180],
      ['CircleGradientLeft',       0.000, 0.180],
      ['CircleGrdientRight',       0.000, 0.180],
      // 2 — both titles, same window
      ['PersonalWellness',          null, null ],
      ['CommunitySupport',          null, null ],
      // 3 — icons, lines and labels, all together
      ['IconSprout',               0.400, 0.540],
      ['IconPeople',               0.400, 0.540],
      ['LineLeft',                 0.400, 0.540],
      ['LineRight',                0.400, 0.540],
      ['TextLeft',                 0.400, 0.540],
      ['TextRight',                0.400, 0.540],
      // 4 — the petal
      ['IntersectionShape',        0.560, 0.640],
      // 5 — the centre lockup, once the petal is down
      ['TheSinglePetal',           0.660, 0.780],
      ['LineMiddle',               0.660, 0.780],
      ['TextMiddle',               0.660, 0.780]
    ];

    /* Both titles share this window and run in parallel — the stagger is
       between the two words *within* each title, not between the sides. Slots
       run 1.5x their step so the pair overlaps, clamped to the batch end. */
    var WORDS_FROM = 0.22, WORDS_TO = 0.38;

    /* Phone only. Below 721 the diagram keeps its circles and petal and hands
       its words to .venn__lock in the markup, so those have to be driven from
       this same progress — left on the generic scroll-reveal they would arrive
       all at once and then sit at full strength while the diagram faded out
       underneath them. Windows chosen to echo the parts they replace: the two
       side lockups around the titles, the third with the petal. */
    var LOCKS = [
      [0.240, 0.420],
      [0.320, 0.500],
      [0.660, 0.800]
    ];

    /* The stroke circles draw from 12 o'clock: the left clockwise, the right
       counter. Direction comes from the transform on each circle in the markup
       — the right one is mirrored about its own centre, which reverses the
       sweep — so both animate the same dashoffset, C down to 0. Length is
       measured rather than derived from r, so retuning the radius needs no
       change here. */
    var draws = [];
    Array.prototype.forEach.call(svg.querySelectorAll('[data-venn-draw]'), function (g) {
      var shape = g.querySelector('circle, path');
      if (!shape || !shape.getTotalLength) return;
      var len = shape.getTotalLength();
      if (!len) return;
      shape.style.strokeDasharray = len.toFixed(2);
      draws.push({ shape: shape, len: len, from: 0.000, to: 0.180 });
    });

    function seg(p, a, b) { return b > a ? clamp01((p - a) / (b - a)) : (p >= b ? 1 : 0); }
    function smooth(t)    { return t * t * (3 - 2 * t); }

    /* Split a title into one <text> per word so each can carry its own blur.
       A <tspan> cannot: `filter` does not apply to it, and the HTML headline
       scrub's <span class="word"> is not valid inside <text> either. Word
       positions come from the original's own glyph metrics, so they land
       exactly where the export put them.

       The element's translate is baked into each word's x/y and the transform
       attribute dropped, because CSS `transform` and the SVG transform
       attribute are one property — writing the settle to style.transform would
       otherwise wipe the positioning and stack every word at the origin.

       The source is cloned and kept: those metrics depend on the font actually
       loaded, so the whole thing is rebuilt once fonts.ready settles. */
    function buildWords(group) {
      if (!group.__src) {
        var t = group.querySelector('text');
        if (!t) return [];
        group.__src = t.cloneNode(true);
      }

      while (group.firstChild) group.removeChild(group.firstChild);

      var probe = group.__src.cloneNode(true);
      group.appendChild(probe);

      var tr = probe.getAttribute('transform') || '';
      var m  = /translate\(\s*([-\d.]+)[ ,]+([-\d.]+)\s*\)/.exec(tr);
      var tx = m ? parseFloat(m[1]) : 0;
      var ty = m ? parseFloat(m[2]) : 0;

      var cls   = probe.getAttribute('class');
      var words = [];
      var offset = 0;

      Array.prototype.forEach.call(probe.querySelectorAll('tspan'), function (tspan) {
        var text = tspan.textContent;
        var re = /\S+/g, hit;
        while ((hit = re.exec(text))) {
          var pos;
          try { pos = probe.getStartPositionOfChar(offset + hit.index); }
          catch (e) { continue; }

          var el = document.createElementNS(NS, 'text');
          if (cls) el.setAttribute('class', cls);
          el.setAttribute('x', (tx + pos.x).toFixed(2));
          el.setAttribute('y', (ty + pos.y).toFixed(2));
          el.textContent = hit[0];
          words.push(el);
        }
        offset += text.length;
      });

      group.removeChild(probe);
      words.forEach(function (el) { group.appendChild(el); });
      return words;
    }

    /* Both titles are split; each word's stagger index is its position within
       its OWN title, so the two sides advance in step rather than in sequence. */
    var words = [];
    function collectWords() {
      words.length = 0;
      Array.prototype.forEach.call(svg.querySelectorAll('[data-venn-words]'), function (g) {
        buildWords(g).forEach(function (el, i, all) {
          words.push({ el: el, i: i, n: all.length });
        });
      });
    }
    collectWords();

    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () {
        collectWords();
        requestFrame();
      });
    }

    /* --- geometry, resolved once per resize --- */
    var top = 0, travel = 0;
    function measure() {
      top    = wrap.getBoundingClientRect().top + window.scrollY;
      travel = wrap.offsetHeight - pin.clientHeight;
    }

    var parts = PARTS.map(function (row) {
      return { el: svg.querySelector('#' + row[0]), row: row };
    }).filter(function (p) { return p.el; });

    /* Outside the SVG, so queried from the document rather than from svg. They
       are display:none above 720 and cost nothing there — the opacity written
       every frame is simply never seen. */
    Array.prototype.forEach.call(
      document.querySelectorAll('.venn__lock'),
      function (el, i) {
        var w = LOCKS[i] || LOCKS[LOCKS.length - 1];
        parts.push({ el: el, row: [null, w[0], w[1]] });
      });

    onFrame(function () {
      if (travel <= 0) return;
      var p = clamp01((window.scrollY - top) / travel);

      // One shared exit for every revealed element, applied as a multiplier.
      var out = smooth(seg(p, EXIT_FROM, EXIT_TO));

      for (var i = 0; i < parts.length; i++) {
        var row = parts[i].row;
        // null window: the group's words drive the entrance, not the group.
        var inT = row[1] === null ? 1 : smooth(seg(p, row[1], row[2]));
        parts[i].el.style.opacity = (inT * (1 - out)).toFixed(3);
      }

      // Stroke draw. The group's opacity above already carries the exit.
      for (var d = 0; d < draws.length; d++) {
        var dt = smooth(seg(p, draws[d].from, draws[d].to));
        draws[d].shape.style.strokeDashoffset = (draws[d].len * (1 - dt)).toFixed(2);
      }

      /* Word-by-word: blur to clear with a slight upward settle. The index is
         within each title, so both titles run in parallel. The group's own
         opacity above carries the exit, so words only describe the entrance. */
      for (var w = 0; w < words.length; w++) {
        var slot = (WORDS_TO - WORDS_FROM) / words[w].n;
        var from = WORDS_FROM + slot * words[w].i;
        var to   = Math.min(WORDS_TO, from + slot * 1.5);
        var t    = smooth(seg(p, from, to));
        var el   = words[w].el;

        el.style.filter = t >= 1 ? 'none'
          : 'blur(' + ((1 - t) * MAX_BLUR).toFixed(2) + 'px)';
        el.style.opacity   = t.toFixed(3);
        el.style.transform = t >= 1 ? 'none'
          : 'translate(0px, ' + ((1 - t) * SETTLE).toFixed(2) + 'px)';
      }
    });

    measure();
    onMeasure(measure);
  })();

  /* ------------------------------------------------------------------------
     8. Ambient span — fades the sticky film in and out at its own edges

        The film is one element across three sections, so there is no seam
        *within* the span by construction. Its two outer edges are the only
        ones left, and both would show as a tonal step: the top where it meets
        the hero's own backdrop, the bottom where sticky containment releases
        it and it scrolls away behind the Single Petal's last screen. Fading
        the layer over the first and last slice of the span removes both.

        Progress comes from the container's own scroll distance. Its document
        offset is resolved once per resize and each frame reads only scrollY —
        the film is sticky, so its rect is frozen while stuck and would freeze
        the value with it.
     ------------------------------------------------------------------------ */
  (function ambientSpan() {
    var span = document.querySelector('.ambient');
    if (!span) return;

    var bg = span.querySelector('.ambient__bg');
    if (!bg) return;

    var PEAK    = 0.15;   // the resting opacity
    var FADE_IN = 0.06;   // fraction of the span spent arriving
    var OUT_OF  = 0.35;   // share of the release travel spent leaving

    /* Reduced motion: no scroll-driven anything. The film sits at its resting
       value and the shared video module has already fallen back to the
       poster. */
    if (reduceMotion) {
      bg.style.setProperty('--ambient-o', String(PEAK));
      return;
    }

    var top = 0, travel = 0, outFrom = 1, outTo = 1;
    function measure() {
      top    = span.getBoundingClientRect().top + window.scrollY;
      travel = span.offsetHeight;
      if (travel <= 0) return;

      /* Where sticky containment lets go: the film stops being pinned once the
         container has less than the film's own height left below the viewport
         top. Derived, not guessed — the span is 100dvh + 300svh + 100dvh and
         the sections can grow, so the ratio is not a constant.

         The fade has to be finished by then, near enough. From the moment it
         releases, the film's bottom edge travels up into view, and a hard edge
         is exactly the seam this whole restructure exists to remove. */
      outFrom = clamp01(1 - bg.offsetHeight / travel);
      outTo   = clamp01(outFrom + (1 - outFrom) * OUT_OF);
    }

    onFrame(function () {
      if (travel <= 0) return;
      var p = clamp01((window.scrollY - top) / travel);
      var t = Math.min(
        clamp01(p / FADE_IN),
        outTo > outFrom ? clamp01((outTo - p) / (outTo - outFrom)) : (p < outFrom ? 1 : 0)
      );
      bg.style.setProperty('--ambient-o', (PEAK * t * t * (3 - 2 * t)).toFixed(4));
    });

    measure();
    onMeasure(measure);
  })();

  /* ------------------------------------------------------------------------
     9. Signup form
        Front-end only: validates, then shows a branded confirmation.
        Nothing is sent anywhere yet — see submitEmail() below to wire it up.
     ------------------------------------------------------------------------ */
  (function signup() {
    var form  = document.getElementById('signup');
    var input = document.getElementById('email');
    var msg   = document.getElementById('signup-msg');
    if (!form || !input || !msg) return;

    // Deliberately permissive: catches typos, never rejects a valid address.
    var EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

    function setMessage(text, state) {
      msg.textContent = '';
      msg.dataset.state = state;

      if (state === 'success') {
        var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        var use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
        use.setAttribute('href', '#i-check');
        svg.setAttribute('aria-hidden', 'true');
        svg.appendChild(use);
        msg.appendChild(svg);
      }
      msg.appendChild(document.createTextNode(text));
    }

    function clearError() {
      input.removeAttribute('aria-invalid');
      form.classList.remove('is-invalid');
      if (msg.dataset.state === 'error') setMessage('', '');
    }

    input.addEventListener('input', clearError);

    form.addEventListener('submit', function (event) {
      event.preventDefault();

      var value = input.value.trim();

      if (!value) {
        input.setAttribute('aria-invalid', 'true');
        form.classList.add('is-invalid');
        setMessage('Please enter your email address.', 'error');
        input.focus();
        return;
      }

      if (!EMAIL.test(value)) {
        input.setAttribute('aria-invalid', 'true');
        form.classList.add('is-invalid');
        setMessage('That email doesn’t look quite right — mind checking it?', 'error');
        input.focus();
        return;
      }

      input.removeAttribute('aria-invalid');
      form.classList.remove('is-invalid');
      submitEmail(value);
    });

    /* ---------------------------------------------------------------------
       Wire this up when the list is ready.
       Replace the body with a fetch() to Mailchimp / ConvertKit / Formspree,
       e.g.:

         return fetch('https://formspree.io/f/XXXXXXX', {
           method: 'POST',
           headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
           body: JSON.stringify({ email: email })
         }).then(showSuccess).catch(showFailure);
       --------------------------------------------------------------------- */
    function submitEmail(email) {
      form.classList.add('is-done');
      setMessage('You’re on the list. Welcome to AYRA, ' + email.split('@')[0] + '.', 'success');
      msg.focus?.();
    }
  })();

  /* ------------------------------------------------------------------------
     10. Anchor scrolling — nav links, footer menu, the scroll cue

        Routed through Lenis when it is running so the jump is eased by the
        same curve as everything else, and falls back to scrollIntoView when
        it is not.

        Both paths land the target below the sticky nav, and both read the
        same CSS to do it: Lenis resolves `scroll-padding-top` on the root and
        `scroll-margin-top` on the target itself, exactly as the browser does
        natively. So no offset is passed here — supplying one double-applies
        the nav height, and the intro's end-of-sequence anchor keeps opting
        out of the offset via its negative scroll-margin either way.
     ------------------------------------------------------------------------ */
  (function anchors() {
    document.querySelectorAll('a[href^="#"]').forEach(function (link) {
      link.addEventListener('click', function (event) {
        var id = link.getAttribute('href');
        if (!id || id === '#') return;          // social placeholders

        var target = document.querySelector(id);
        if (!target) return;

        event.preventDefault();

        if (lenis) {
          lenis.scrollTo(target);
        } else {
          target.scrollIntoView({
            behavior: reduceMotion ? 'auto' : 'smooth',
            block: 'start'
          });
        }

        // Keep keyboard focus in sync with the visual jump.
        target.setAttribute('tabindex', '-1');
        target.focus({ preventScroll: true });
      });
    });
  })();

  /* ------------------------------------------------------------------------
     11. Gentle settle — Join Us and Contact only

        Not CSS scroll-snap. That has no duration and no easing to give, and
        with Lenis writing the scroll position every frame the browser's own
        snap animation is overwritten while it runs, so it arrives as a jump.
        Going through the same Lenis instance is the whole reason this reads as
        a drift instead.

        It only ever acts once scrolling has already stopped, and only from
        inside a shallow band around each of the two section tops, so it is a
        settle rather than a magnet: rest anywhere further out and it leaves
        you alone.
     ------------------------------------------------------------------------ */
  (function gentleSettle() {
    if (reduceMotion) return;

    var sections = ['.cta', '.footer']
      .map(function (sel) { return document.querySelector(sel); })
      .filter(Boolean);
    if (!sections.length) return;

    /* Shallow on purpose. Past about a sixth of the viewport the section is no
       longer the thing you were heading for, and moving the page then reads as
       the page overruling you. */
    var BAND  = 0.16;
    var IDLE  = 160;    // ms of stillness before a scroll counts as finished
    var DEAD  = 2;      // already close enough; moving would be a twitch

    var timer = null;
    var moving = false;

    function settle() {
      if (moving) return;

      var reach = window.innerHeight * BAND;
      var best = null;
      var bestDist = Infinity;

      for (var i = 0; i < sections.length; i++) {
        var top  = sections[i].getBoundingClientRect().top;
        var dist = Math.abs(top);
        if (dist > DEAD && dist < reach && dist < bestDist) {
          bestDist = dist;
          best = sections[i];
        }
      }
      if (!best) return;

      /* Resolved to an absolute offset rather than handed the element: these
         sections carry a negative scroll-margin to cancel the root's
         scroll-padding, and this way the landing does not depend on how that
         pair is interpreted. Section top to viewport top, exactly where a nav
         link puts it. */
      var y = window.scrollY + best.getBoundingClientRect().top;

      moving = true;
      var release = function () { moving = false; };

      if (lenis) {
        lenis.scrollTo(y, {
          /* Long and soft. The distance is at most a sixth of the viewport, so
             a slow ease over that little ground is a drift you notice only
             afterwards — which is the point. */
          duration: 1.1,
          easing: function (t) { return 1 - Math.pow(1 - t, 3); },
          onComplete: release
        });
      } else {
        window.scrollTo({ top: y, behavior: 'smooth' });
        setTimeout(release, 900);
      }
      /* Lenis calls onComplete, but a scroll interrupted mid-flight may not
         get there — without this the flag could latch and disable the settle
         for the rest of the session. */
      setTimeout(release, 1600);
    }

    window.addEventListener('scroll', function () {
      if (moving) return;
      clearTimeout(timer);
      timer = setTimeout(settle, IDLE);
    }, { passive: true });
  })();

  /* ------------------------------------------------------------------------
    12. Boot — start Lenis and the single frame loop

        Lenis drives the real document scroll position (its default; there is
        no transform mode). That is what keeps `position: sticky` on the nav,
        the sticky intro stage, and every IntersectionObserver on the page
        working untouched — they all read the same scrollY they always did.

        Under prefers-reduced-motion Lenis is never constructed, and the page
        falls back to plain native scrolling.
     ------------------------------------------------------------------------ */
  (function boot() {
    var hasLenis = !reduceMotion && typeof Lenis === 'function';

    if (hasLenis) {
      lenis = new Lenis({
        lerp: 0.1,          // Lenis default — glide, not float
        smoothWheel: true,
        syncTouch: false,   // leave touch to native momentum
        anchors: false,     // the anchors module owns link clicks
        autoRaf: false      // this loop owns the rAF
      });

      window.requestAnimationFrame(function loop(time) {
        lenis.raf(time);
        runFrame();         // reads the position Lenis just settled
        window.requestAnimationFrame(loop);
      });
    } else {
      window.addEventListener('scroll', requestFrame, { passive: true });
    }

    function remeasure() { runMeasure(); requestFrame(); }

    window.addEventListener('resize', remeasure);
    window.addEventListener('orientationchange', remeasure);
    window.addEventListener('load', remeasure);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(remeasure);

    runMeasure();
    runFrame();
  })();

})();
