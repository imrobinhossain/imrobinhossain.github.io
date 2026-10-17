console.log('script.js loaded');

// Track preloader start time from when script loads
const preloaderStartTime = Date.now();
console.log('Preloader tracking started at:', preloaderStartTime);

// Kokonut UI - Pull Cord Theme Switcher (BT-10)
(function() {
    const html = document.documentElement;
    const themeToggle = document.getElementById('theme-toggle');
    if (!themeToggle) return;

    const svg = themeToggle.querySelector('.pull-cord-svg');
    const cordPathEl = themeToggle.querySelector('.pull-cord-line');
    const cordHitEl = themeToggle.querySelector('.pull-cord-hit');
    const beadGroup = themeToggle.querySelector('.pull-cord-bead');

    // Web Audio realistic mechanical pull-chain click sound
    let audioCtx = null;
    function playPullClickSound() {
        try {
            if (!audioCtx) {
                const AudioContextClass = window.AudioContext || window.webkitAudioContext;
                if (AudioContextClass) audioCtx = new AudioContextClass();
            }
            if (audioCtx && audioCtx.state === 'suspended') {
                audioCtx.resume();
            }
            if (!audioCtx) return;

            const t = audioCtx.currentTime;
            // Primary crisp metallic transient
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(1400, t);
            osc.frequency.exponentialRampToValueAtTime(320, t + 0.045);
            gain.gain.setValueAtTime(0.25, t);
            gain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.start(t);
            osc.stop(t + 0.05);

            // Secondary subtle spring resonance
            const osc2 = audioCtx.createOscillator();
            const gain2 = audioCtx.createGain();
            osc2.type = 'sine';
            osc2.frequency.setValueAtTime(650, t + 0.015);
            osc2.frequency.exponentialRampToValueAtTime(180, t + 0.06);
            gain2.gain.setValueAtTime(0.12, t + 0.015);
            gain2.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
            osc2.connect(gain2);
            gain2.connect(audioCtx.destination);
            osc2.start(t + 0.015);
            osc2.stop(t + 0.07);
        } catch (e) {
            // Audio error non-blocking
        }
    }

    function haptic() {
        if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
            try { navigator.vibrate(8); } catch (e) {}
        }
    }

    // Theme state persistence & application
    function getStoredTheme() {
        return localStorage.getItem('theme');
    }

    function updateComponentAria(theme) {
        const isDark = theme === 'dark';
        themeToggle.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');
        themeToggle.setAttribute('aria-checked', isDark ? 'false' : 'true');
        themeToggle.setAttribute('title', isDark ? 'Pull the cord for light mode' : 'Pull the cord for dark mode');
    }

    function setTheme(theme) {
        html.setAttribute('data-theme', theme);
        localStorage.setItem('theme', theme);
        updateComponentAria(theme);
        window.dispatchEvent(new CustomEvent('themeChanged', { detail: { theme } }));
    }

    function toggleTheme() {
        const current = html.getAttribute('data-theme') || 'dark';
        const next = current === 'dark' ? 'light' : 'dark';
        setTheme(next);
        haptic();
        playPullClickSound();
    }

    // Kokonut UI Simulation Constants (matching BT-10)
    const ANCHOR = { x: 180, y: 116 };
    const LINKS = 12;
    const LINK = 8.5;
    const STEP = 1 / 120;
    const GRAVITY = 1400;
    const DAMPING = 0.992;
    const MAX_SPEED = 4;
    const BEND_MIN = LINK * 1.9;
    const BEND_STIFFNESS = 0.8;
    const ITERATIONS = 14;
    const CLICK_PULL = 22;
    const MAX_STRETCH = 34;
    const REST_EPSILON = 0.015;
    const REST_STEPS = 24;

    function damp(distance, max) {
        return max * (1 - Math.exp(-distance / max));
    }

    function relax(chain, a, b, length, bend) {
        const { xs, ys, held } = chain;
        const aFixed = a === 0 || a === held;
        const bFixed = b === held;
        if (aFixed && bFixed) return;

        const dx = xs[b] - xs[a];
        const dy = ys[b] - ys[a];
        const dist = Math.hypot(dx, dy) || 0.0001;
        if (bend && dist >= length) return;

        const diff = ((dist - length) / dist) * (bend ? BEND_STIFFNESS : 1);
        let wa = 0.5;
        if (aFixed) {
            wa = 0;
        } else if (bFixed) {
            wa = 1;
        }
        xs[a] += dx * diff * wa;
        ys[a] += dy * diff * wa;
        xs[b] -= dx * diff * (1 - wa);
        ys[b] -= dy * diff * (1 - wa);
    }

    function cordPath(xs, ys) {
        let d = `M${xs[0].toFixed(2)} ${ys[0].toFixed(2)}`;
        for (let i = 1; i < xs.length - 1; i++) {
            const mx = (xs[i] + xs[i + 1]) / 2;
            const my = (ys[i] + ys[i + 1]) / 2;
            d += ` Q${xs[i].toFixed(2)} ${ys[i].toFixed(2)} ${mx.toFixed(2)} ${my.toFixed(2)}`;
        }
        const n = xs.length - 1;
        d += ` L${xs[n].toFixed(2)} ${ys[n].toFixed(2)}`;
        return d;
    }

    function restingChain() {
        const xs = new Float64Array(LINKS + 1);
        const ys = new Float64Array(LINKS + 1);
        for (let i = 0; i <= LINKS; i++) {
            xs[i] = ANCHOR.x;
            ys[i] = ANCHOR.y + i * LINK;
        }
        return { xs, ys };
    }

    const REST = restingChain();

    // Simulation state
    const sim = {
        xs: Float64Array.from(REST.xs),
        ys: Float64Array.from(REST.ys),
        pxs: Float64Array.from(REST.xs),
        pys: Float64Array.from(REST.ys),
        raf: 0,
        last: 0,
        carry: 0,
        still: 0,
        held: -1,
        targetX: 0,
        targetY: 0,
        armed: true,
        reduceMotion: false
    };

    sim.reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function draw() {
        if (!cordPathEl || !beadGroup) return;
        const { xs, ys } = sim;
        const d = cordPath(xs, ys);
        cordPathEl.setAttribute('d', d);
        if (cordHitEl) cordHitEl.setAttribute('d', d);

        const n = LINKS;
        const angle = (Math.atan2(xs[n] - xs[n - 1], ys[n] - ys[n - 1]) * 180) / Math.PI;
        beadGroup.setAttribute(
            'transform',
            `translate(${xs[n].toFixed(2)} ${ys[n].toFixed(2)}) rotate(${(-angle).toFixed(2)})`
        );
    }

    function integrate() {
        const { xs, ys, pxs, pys } = sim;
        let moved = 0;
        for (let i = 1; i <= LINKS; i++) {
            if (i === sim.held) continue;
            let vx = (xs[i] - pxs[i]) * DAMPING;
            let vy = (ys[i] - pys[i]) * DAMPING;
            const speed = Math.hypot(vx, vy);
            if (speed > MAX_SPEED) {
                vx *= MAX_SPEED / speed;
                vy *= MAX_SPEED / speed;
            }
            pxs[i] = xs[i];
            pys[i] = ys[i];
            xs[i] += vx;
            ys[i] += vy + GRAVITY * STEP * STEP;
            moved = Math.max(moved, Math.abs(vx) + Math.abs(vy));
        }
        if (sim.held > 0) {
            const i = sim.held;
            moved = Math.max(
                moved,
                Math.abs(sim.targetX - xs[i]) + Math.abs(sim.targetY - ys[i])
            );
            pxs[i] = xs[i];
            pys[i] = ys[i];
            xs[i] = sim.targetX;
            ys[i] = sim.targetY;
        }
        return moved;
    }

    function constrain() {
        for (let k = 0; k < ITERATIONS; k++) {
            for (let i = 0; i < LINKS; i++) {
                relax(sim, i, i + 1, LINK, false);
            }
            for (let i = 0; i + 2 <= LINKS; i++) {
                relax(sim, i, i + 2, BEND_MIN, true);
            }
        }
    }

    function step() {
        const moved = integrate();
        constrain();
        return moved;
    }

    function tick(now) {
        sim.raf = 0;
        const elapsed = sim.last ? Math.min((now - sim.last) / 1000, 0.05) : STEP;
        sim.last = now;
        sim.carry += elapsed;
        let moved = 0;
        while (sim.carry >= STEP) {
            moved = Math.max(moved, step());
            sim.carry -= STEP;
        }
        draw();
        sim.still = moved < REST_EPSILON ? sim.still + 1 : 0;
        if (sim.held > 0 || sim.still < REST_STEPS) {
            sim.raf = requestAnimationFrame(tick);
        } else {
            sim.last = 0;
        }
    }

    function wake() {
        sim.still = 0;
        if (!sim.raf) {
            sim.raf = requestAnimationFrame(tick);
        }
    }

    function localPoint(event) {
        if (!svg) return { x: ANCHOR.x, y: ANCHOR.y + LINKS * LINK };
        const rect = svg.getBoundingClientRect();
        if (!rect.width || !rect.height) return { x: ANCHOR.x, y: ANCHOR.y + LINKS * LINK };
        const vb = svg.viewBox.baseVal;
        return {
            x: vb.x + ((event.clientX - rect.left) / rect.width) * vb.width,
            y: vb.y + ((event.clientY - rect.top) / rect.height) * vb.height
        };
    }

    function reach(index, x, y) {
        const dx = x - ANCHOR.x;
        const dy = y - ANCHOR.y;
        const dist = Math.hypot(dx, dy) || 0.0001;
        const length = index * LINK;
        if (dist <= length) {
            return { x, y, pull: 0 };
        }
        const allowed = length + damp(dist - length, MAX_STRETCH);
        return {
            x: ANCHOR.x + (dx / dist) * allowed,
            y: ANCHOR.y + (dy / dist) * allowed,
            pull: dy > 0 ? (allowed - length) * (dy / dist) : 0
        };
    }

    // Tug impulse when tapped, clicked, or triggered by key
    function tugCord() {
        toggleTheme();
        if (!sim.reduceMotion) {
            sim.pys[LINKS] = sim.ys[LINKS] - 22;
            sim.pxs[LINKS] = sim.xs[LINKS] + (Math.random() > 0.5 ? 7 : -7);
            wake();
        }
    }

    // Pointer interaction handling
    let pointerDownTime = 0;
    let pointerDownPos = { x: 0, y: 0 };
    let didClickDuringDrag = false;

    function handlePointerDown(event) {
        if (sim.held > 0) return;
        if (event.pointerType === 'mouse' && event.button !== 0) return;

        event.preventDefault();
        const point = localPoint(event);
        pointerDownTime = Date.now();
        pointerDownPos = { x: point.x, y: point.y };
        didClickDuringDrag = false;

        let nearest = LINKS;
        let best = Number.POSITIVE_INFINITY;
        for (let i = 1; i <= LINKS; i++) {
            const d = Math.hypot(sim.xs[i] - point.x, sim.ys[i] - point.y);
            if (d < best) {
                best = d;
                nearest = i;
            }
        }

        try {
            if (svg && svg.setPointerCapture) {
                svg.setPointerCapture(event.pointerId);
            }
        } catch (e) {}

        sim.held = nearest;
        sim.targetX = sim.xs[nearest];
        sim.targetY = sim.ys[nearest];
        sim.armed = true;
        themeToggle.classList.add('is-grabbing');
        wake();
    }

    function handlePointerMove(event) {
        if (sim.held < 0) return;
        const point = localPoint(event);
        const target = reach(sim.held, point.x, point.y);
        sim.targetX = target.x;
        sim.targetY = target.y;

        if (sim.armed && target.pull > CLICK_PULL) {
            sim.armed = false;
            didClickDuringDrag = true;
            toggleTheme();
        } else if (!sim.armed && target.pull < CLICK_PULL * 0.4) {
            sim.armed = true;
        }
        wake();
    }

    function handlePointerUp(event) {
        if (sim.held < 0) return;
        sim.held = -1;
        themeToggle.classList.remove('is-grabbing');

        // Check if quick tap/click without drag
        const point = event ? localPoint(event) : pointerDownPos;
        const dist = Math.hypot(point.x - pointerDownPos.x, point.y - pointerDownPos.y);
        const duration = Date.now() - pointerDownTime;

        if (!didClickDuringDrag && duration < 380 && dist < 16) {
            tugCord();
            return;
        }

        if (sim.reduceMotion) {
            sim.xs.set(REST.xs);
            sim.ys.set(REST.ys);
            sim.pxs.set(REST.xs);
            sim.pys.set(REST.ys);
            draw();
            return;
        }
        wake();
    }

    // Bind pointer events on SVG and interactive parts
    if (svg) {
        svg.addEventListener('pointerdown', handlePointerDown);
        svg.addEventListener('pointermove', handlePointerMove);
        svg.addEventListener('pointerup', handlePointerUp);
        svg.addEventListener('pointercancel', handlePointerUp);
        svg.addEventListener('lostpointercapture', handlePointerUp);
    }

    // Keyboard support: Enter / Space triggers cord tug
    themeToggle.addEventListener('keydown', function(e) {
        if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault();
            tugCord();
        }
    });

    // Shade click also pulls the cord
    const shade = themeToggle.querySelector('.lamp-shade');
    if (shade) {
        shade.addEventListener('click', function(e) {
            e.stopPropagation();
            tugCord();
        });
    }

    // Listen for system theme changes
    if (window.matchMedia) {
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
            if (!getStoredTheme()) {
                const theme = e.matches ? 'dark' : 'light';
                setTheme(theme);
            }
        });
    }

    // Initialize theme on start
    function initTheme() {
        const stored = getStoredTheme();
        const theme = stored || 'dark';
        setTheme(theme);
        draw();
    }

    initTheme();
})();

/* Sticky header accent color sampler
   - Samples the page background (prefers .particle-background if present)
   - Extracts a representative color from gradients or solid backgrounds
   - Updates the existing .sticky-header element's CSS variables:
       --sticky-accent-rgb
   - Smoothly transitions via the CSS transitions added to .sticky-header
   This script does NOT create any new CSS classes; it only updates variables
   on the existing `.sticky-header` element. */
(function(){
    function hexToRgb(hex) {
        const h = hex.replace('#', '');
        const bigint = parseInt(h.length === 3 ? h.split('').map(c=>c+c).join('') : h, 16);
        return { r: (bigint >> 16) & 255, g: (bigint >> 8) & 255, b: bigint & 255 };
    }

    function parseRgbString(str) {
        const m = str.match(/rgba?\s*\(([^)]+)\)/i);
        if (!m) return null;
        const parts = m[1].split(',').map(p=>p.trim());
        return { r: parseInt(parts[0]), g: parseInt(parts[1]), b: parseInt(parts[2]) };
    }

    function extractColorsFromCss(bg) {
        if (!bg) return null;
        // Try to find rgb(...) or rgba(...)
        const rgbMatch = bg.match(/rgba?\([^)]*\)/gi);
        if (rgbMatch && rgbMatch.length) {
            return rgbMatch.map(s => parseRgbString(s)).filter(Boolean);
        }
        // Try to find hex colors
        const hexMatch = bg.match(/#([0-9a-fA-F]{3,6})/g);
        if (hexMatch && hexMatch.length) {
            return hexMatch.map(h => hexToRgb(h));
        }
        return null;
    }

    function applyAccent(rgb) {
        if (!rgb) return;
        const el = document.querySelector('.sticky-header');
        if (!el) return;
        const value = `${Math.round(rgb.r)}, ${Math.round(rgb.g)}, ${Math.round(rgb.b)}`;
        el.style.setProperty('--sticky-accent-rgb', value);
    }

    function sampleBackground() {
        try {
            const preferred = document.querySelector('.particle-background') || document.body;
            const cs = window.getComputedStyle(preferred);
            const bg = cs.backgroundImage || cs.background || cs.backgroundColor || '';
            const colors = extractColorsFromCss(bg);
            if (colors && colors.length) {
                // pick a middle color if gradient, otherwise first
                const pick = colors[Math.floor(colors.length / 2)];
                applyAccent(pick);
                return;
            }

            // fallback: if no usable css color, try reading body computed background-color
            const bodyBg = window.getComputedStyle(document.body).backgroundColor;
            const parsed = parseRgbString(bodyBg);
            if (parsed) applyAccent(parsed);
        } catch (e) {
            console.warn('Sticky accent sampler error:', e);
        }
    }

    function debounce(fn, wait){ let t; return function(){ clearTimeout(t); t=setTimeout(()=>fn(), wait);} }

    document.addEventListener('DOMContentLoaded', function(){
        // initial sample
        sampleBackground();

        // re-sample when the document's class/style attributes change
        const observer = new MutationObserver(debounce(sampleBackground, 220));
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class','style'] });
        observer.observe(document.body, { attributes: true, attributeFilter: ['class','style'] });

        // also resample on resize (background gradients might be responsive)
        window.addEventListener('resize', debounce(sampleBackground, 200));
    });
})();

// PRELOADER PAUSED - Hide scrollbar immediately when script loads
if (window.innerWidth <= 768) {
    if (document.body) {
        document.body.classList.add('preloader-active');
    } else {
        document.addEventListener('DOMContentLoaded', function() {
            document.body.classList.add('preloader-active');
        });
    }
}

// Global Variables
let isMenuOpen = false;
let skillsAnimated = false;
let mouse = { x: 0, y: 0 };

// Profile Image Flip Card Variables
let profileFlipTimer = null;
let isInAboutSection = false;
let aboutSectionStartTime = null;

// --- HERO PARTICLE SYSTEM ---
let heroParticles = [];

// --- BACKGROUND PARTICLE SYSTEM ---
let backgroundParticles = [];
let backgroundCanvas, backgroundCtx;
let mousePos = { x: null, y: null };

/* ==========================================================================
   FRAMER CURSOR DOT TRAIL SYSTEM (Dark Mode Only, Desktop Only)
   Cloned directly from: https://framer.com/m/CursorDotTrail-ZDqFAE.js@iLyzK205nNCuHNDP5Nsc
   ========================================================================== */

// Check if current theme is light mode
function isLightMode() {
    return document.documentElement.getAttribute('data-theme') === 'light';
}

function initFramerCursorDotTrail() {
    // Only initialize on desktop
    if (window.matchMedia && !window.matchMedia('(min-width: 1025px)').matches) {
        return;
    }

    const canvas = document.getElementById('cursor-dot-trail-canvas');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Component parameters matching Framer CursorDotTrail specification
    const config = {
        color: '#FFFFFF',          // Pure white in Dark Mode
        colorInverted: '#080808',  // Inverted color for light elements
        size: 12,                  // Dot Size in px (radius 6)
        hoverSize: 40,             // Hover Size in px (radius 20)
        borderWidth: 2,            // Border width of expanding ring
        spring: 0.15,              // Follow spring stiffness
        friction: 0.5,             // Follow friction damping
        trailDuration: 200,        // Trail duration in ms
        transitionSpeed: 0.15      // Lerp transition speed
    };

    let points = [];
    let ball = { x: -2000, y: -2000 };
    let target = { x: -2000, y: -2000 };
    let velocity = { x: 0, y: 0 };
    let animId = null;
    let lastTime = performance.now();
    let hasMoved = false;
    let isVisible = false;

    let radius = config.size / 2;
    let fillOpacity = 1;
    let strokeOpacity = 0;
    let lineOpacity = 0;
    let lineWidth = 0;
    let lineTargetWidth = 0;
    let lineProgress = 0;

    function lerp(from, to, amt) {
        return from + (to - from) * amt;
    }

    function hexToRgba(color, alpha) {
        if (!color) return `rgba(255, 255, 255, ${alpha})`;
        if (color.startsWith('rgba')) {
            return color.replace(/rgba\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*[^)]+\)/, (_, r, g, b) => `rgba(${r},${g},${b},${alpha})`);
        }
        if (color.startsWith('rgb(')) {
            const body = color.slice(4, -1);
            return `rgba(${body}, ${alpha})`;
        }
        if (color.startsWith('#')) {
            let r = 0, g = 0, b = 0;
            if (color.length === 4) {
                r = parseInt(color[1] + color[1], 16);
                g = parseInt(color[2] + color[2], 16);
                b = parseInt(color[3] + color[3], 16);
            } else if (color.length === 7) {
                r = parseInt(color.slice(1, 3), 16);
                g = parseInt(color.slice(3, 5), 16);
                b = parseInt(color.slice(5, 7), 16);
            }
            return `rgba(${r}, ${g}, ${b}, ${alpha})`;
        }
        return `rgba(255, 255, 255, ${alpha})`;
    }

    function resize() {
        const dpr = Math.max(1, window.devicePixelRatio || 1);
        const w = window.innerWidth;
        const h = window.innerHeight;
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
        canvas.width = Math.floor(w * dpr);
        canvas.height = Math.floor(h * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        if (!hasMoved) {
            ball = { x: w / 2, y: h / 2 };
            target = { x: w / 2, y: h / 2 };
        }
    }

    resize();
    window.addEventListener('resize', resize);

    const onMouseMove = (e) => {
        target.x = e.clientX;
        target.y = e.clientY;
        if (!hasMoved) {
            ball.x = e.clientX;
            ball.y = e.clientY;
            hasMoved = true;
        }
        isVisible = true;
    };

    window.addEventListener('mousemove', onMouseMove, { passive: true });

    document.addEventListener('mouseenter', () => {
        isVisible = true;
    });

    document.addEventListener('mouseleave', () => {
        isVisible = false;
        points = [];
    });

    function animate() {
        if (isLightMode()) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            animId = requestAnimationFrame(animate);
            return;
        }

        const now = performance.now();
        const dt = Math.min(now - lastTime, 33);
        lastTime = now;

        const w = window.innerWidth;
        const h = window.innerHeight;
        ctx.clearRect(0, 0, w, h);

        if (!isVisible || !hasMoved) {
            animId = requestAnimationFrame(animate);
            return;
        }

        // Spring physics matching Framer CursorDotTrail
        const dx = target.x - ball.x;
        const dy = target.y - ball.y;
        velocity.x += dx * config.spring;
        velocity.y += dy * config.spring;
        velocity.x *= config.friction;
        velocity.y *= config.friction;
        ball.x += velocity.x;
        ball.y += velocity.y;

        // Trail points tracking with age
        points.push({ x: ball.x, y: ball.y, age: 0 });
        for (let i = 0; i < points.length; i++) {
            points[i].age += dt;
        }
        points = points.filter(p => p.age < config.trailDuration);

        // Element under cursor
        const el = document.elementFromPoint(target.x, target.y);

        // Hide trail on specified elements
        const isHideTrail = !!el?.closest('[aria-label~="trail{hide}"],[data-framer-name~="trail{hide}"]');
        if (isHideTrail) {
            ctx.clearRect(0, 0, w, h);
            animId = requestAnimationFrame(animate);
            return;
        }

        // Color inversion check
        const isInvertColor = !!el?.closest('[aria-label~="trail{invert-color}"],[data-framer-name~="trail{invert-color}"]');
        const currentColor = isInvertColor ? config.colorInverted : config.color;

        // Draw trail stroke with fading gradient
        if (points.length > 1) {
            ctx.beginPath();
            ctx.moveTo(points[0].x, points[0].y);
            for (let i = 1; i < points.length; i++) {
                const p = points[i];
                ctx.lineTo(p.x, p.y);
            }
            const oldest = points[0];
            const newest = points[points.length - 1];
            const oldestOpacity = 1 - oldest.age / config.trailDuration;
            const gradient = ctx.createLinearGradient(oldest.x, oldest.y, newest.x, newest.y);
            gradient.addColorStop(0, hexToRgba(currentColor, Math.max(0, oldestOpacity * 0.3)));
            gradient.addColorStop(1, hexToRgba(currentColor, 1));
            ctx.strokeStyle = gradient;
            ctx.lineWidth = Math.max(2, config.size / 4);
            ctx.lineCap = "round";
            ctx.lineJoin = "round";
            ctx.stroke();
        }

        // Interactive detection (matches Framer isRing & isLink, plus portfolio interactive elements)
        const isRing = !!el?.closest("a, button, [role~='button'], .btn, .nav-link, .portfolio-tab, .accordion-header, .social-link, .kokonut-pull-cord, .clickable, input, textarea, select, .project-card, .achievements-card, .skill-item");
        const hideDot = !!el?.closest('[aria-label~="button"]');
        const linkEl = el?.closest('[aria-label~="trail{link}"],[data-framer-name~="trail{link}"]');
        const isLink = !!linkEl;

        // Target radius and opacities (dot morphs to hollow ring on hover)
        const targetRadius = (!isRing && !isLink) ? (config.size / 2) : (config.hoverSize / 2);
        radius = lerp(radius, targetRadius, config.transitionSpeed);
        fillOpacity = lerp(fillOpacity, (isRing || isLink) ? 0 : 1, config.transitionSpeed);
        strokeOpacity = lerp(strokeOpacity, isRing ? 1 : 0, config.transitionSpeed);
        lineOpacity = lerp(lineOpacity, isLink ? 1 : 0, config.transitionSpeed);

        // Underline animation for trail{link}
        const targetProgress = isLink ? 1 : 0;
        lineProgress = lerp(lineProgress, targetProgress, 0.15);
        if (isLink && linkEl) {
            const rect = linkEl.getBoundingClientRect();
            lineTargetWidth = rect.width;
        } else {
            lineTargetWidth = 0;
        }
        lineWidth = lerp(lineWidth, lineTargetWidth * lineProgress, config.transitionSpeed);

        if (!hideDot) {
            if (isLink && lineOpacity > 0.01 && linkEl) {
                const linkRect = linkEl.getBoundingClientRect();
                const y = linkRect.bottom + 1;
                const currentWidth = lineWidth;
                const startX = linkRect.left + (linkRect.width - currentWidth) / 2;
                ctx.beginPath();
                ctx.moveTo(startX, y);
                ctx.lineTo(startX + currentWidth, y);
                ctx.strokeStyle = hexToRgba(currentColor, lineOpacity);
                ctx.lineWidth = Math.max(1, config.borderWidth - 1);
                ctx.stroke();
            } else {
                ctx.beginPath();
                ctx.arc(ball.x, ball.y, radius, 0, Math.PI * 2);
                if (strokeOpacity > 0.01) {
                    ctx.strokeStyle = hexToRgba(currentColor, strokeOpacity);
                    ctx.lineWidth = config.borderWidth;
                    ctx.stroke();
                }
                if (fillOpacity > 0.01) {
                    ctx.fillStyle = hexToRgba(currentColor, fillOpacity);
                    ctx.fill();
                }
            }
        }

        animId = requestAnimationFrame(animate);
    }

    lastTime = performance.now();
    animId = requestAnimationFrame(animate);

    function updateThemeState() {
        if (isLightMode()) {
            canvas.style.display = 'none';
        } else {
            canvas.style.display = 'block';
            resize();
        }
    }

    window.addEventListener('themeChanged', updateThemeState);
    const themeObserver = new MutationObserver(updateThemeState);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    updateThemeState();
}

/* ==========================================================================
   FRAMER MOUSE TRAIL SYSTEM (Light Mode Theme Only)
   Cloned directly from: https://framer.com/m/Mouse-trail-q6Fq.js@VTKySs2XVK542u5K0zaJ
   ========================================================================== */
function initFramerMouseTrail() {
    if (window.matchMedia && !window.matchMedia('(min-width: 1025px)').matches) {
        return;
    }

    const canvas = document.getElementById('mouse-trail-canvas');
    if (!canvas) return;

    // Component parameters matching Framer MouseTrail component specification
    const config = {
        variant: "line",           // "line" | "dots" | "particles" | "pixel"
        fillType: "solid",         // "solid" | "gradient"
        trailColor: "#0099FF",     // Default component color (Signature Framer Cyan/Blue)
        trailColorEnd: "#FF00FF",  // Gradient end color
        trailLength: 25,           // Trail length
        lineWidth: 3.5,            // Line width in px
        fadeOut: true,             // Fade trail towards tail
        smoothing: 0.3,            // Motion smoothing factor
        dotSize: 6,
        dotSpacing: 10,
        particleCount: 6,
        particleSize: 3,
        spreadAngle: 30,
        drift: 0.4,
        pixelSize: 6,
        snapToGrid: true,
        blendMode: "source-over",
        autoFade: true,
        fadeDuration: 1.8          // Seconds until trail dissolves when stationary
    };

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let trailPoints = [];
    let particles = [];
    let rafId = null;
    let lastTime = performance.now();
    let isRunning = false;

    // Helper: Parse color (hex or rgb) into {r, g, b}
    function parseColor(col) {
        if (!col) return { r: 0, g: 153, b: 255 };
        if (col.startsWith("#")) {
            let hex = col.slice(1);
            if (hex.length === 3) {
                hex = hex.split("").map(c => c + c).join("");
            }
            return {
                r: parseInt(hex.slice(0, 2), 16),
                g: parseInt(hex.slice(2, 4), 16),
                b: parseInt(hex.slice(4, 6), 16)
            };
        } else if (col.startsWith("rgb")) {
            const m = col.match(/\d+/g);
            return m ? { r: +m[0], g: +m[1], b: +m[2] } : { r: 0, g: 153, b: 255 };
        }
        return { r: 0, g: 153, b: 255 };
    }

    const rgbStart = parseColor(config.trailColor);
    const rgbEnd = parseColor(config.trailColorEnd);

    function rgba(a, t) {
        const clampedAlpha = Math.max(0, Math.min(1, a));
        if (config.fillType === "gradient") {
            const r = rgbStart.r + (rgbEnd.r - rgbStart.r) * t;
            const g = rgbStart.g + (rgbEnd.g - rgbStart.g) * t;
            const b = rgbStart.b + (rgbEnd.b - rgbStart.b) * t;
            return `rgba(${r | 0}, ${g | 0}, ${b | 0}, ${clampedAlpha})`;
        }
        return `rgba(${rgbStart.r}, ${rgbStart.g}, ${rgbStart.b}, ${clampedAlpha})`;
    }

    function indexAlpha(i, n) {
        if (!config.fadeOut) return 1;
        const t = n <= 1 ? 1 : i / (n - 1);
        return 1 - (1 - t) * (1 - t);
    }

    // Responsive canvas resizing with DPR scaling
    function resizeCanvas() {
        const dpr = window.devicePixelRatio || 1;
        const width = window.innerWidth;
        const height = window.innerHeight;
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
        canvas.style.width = width + 'px';
        canvas.style.height = height + 'px';
    }

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // Track pointer movement
    function handlePointerMove(e) {
        if (!isLightMode()) return;

        const x = e.clientX;
        const y = e.clientY;
        const last = trailPoints[trailPoints.length - 1];

        // Debounce dots based on spacing
        if (config.variant === "dots" && last) {
            const dx = x - last.x;
            const dy = y - last.y;
            if (Math.hypot(dx, dy) < config.dotSpacing) return;
        }

        // Smoothing (interpolation)
        const s = Math.max(0.001, 1 - config.smoothing);
        const sx = last ? last.x + (x - last.x) * s : x;
        const sy = last ? last.y + (y - last.y) * s : y;
        trailPoints.push({ x: sx, y: sy, life: 1 });

        // Trim trail length
        if (trailPoints.length > config.trailLength) {
            trailPoints.splice(0, trailPoints.length - config.trailLength);
        }

        // Spawn particles
        if (config.variant === "particles" && last) {
            const dx = sx - last.x;
            const dy = sy - last.y;
            const speed = Math.hypot(dx, dy);
            if (speed > 2) {
                const angle = Math.atan2(dy, dx);
                const spread = (config.spreadAngle * Math.PI) / 180;
                for (let i = 0; i < config.particleCount; i++) {
                    const a = angle + (Math.random() - 0.5) * spread;
                    const v = speed * 0.1 + Math.random() * 2;
                    particles.push({
                        x: sx,
                        y: sy,
                        vx: Math.cos(a) * v,
                        vy: Math.sin(a) * v,
                        life: 0.8 + Math.random() * 0.4,
                        size: config.particleSize + Math.random() * 1.5
                    });
                }
            }
        }

        if (!isRunning) {
            startLoop();
        }
    }

    document.addEventListener('pointermove', handlePointerMove, { passive: true });

    function updateAndDrawParticles(dt) {
        const damping = Math.pow(0.98, dt * 60);
        const g = config.drift * 60 * 0.001 * dt * 60;
        const decayP = 1.6 * dt;
        for (let i = particles.length - 1; i >= 0; i--) {
            const pt = particles[i];
            pt.x += pt.vx * dt * 60;
            pt.y += pt.vy * dt * 60;
            pt.vx *= damping;
            pt.vy = pt.vy * damping + g;
            pt.life -= decayP;
            if (pt.life <= 0) {
                particles[i] = particles[particles.length - 1];
                particles.pop();
            } else {
                ctx.fillStyle = rgba(pt.life, 1 - pt.life);
                ctx.beginPath();
                ctx.arc(pt.x, pt.y, pt.size * pt.life, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    }

    // Animation frame render loop
    function animate(now) {
        if (!isLightMode()) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            trailPoints = [];
            particles = [];
            isRunning = false;
            return;
        }

        let dt = (now - lastTime) / 1000;
        dt = Math.max(0, Math.min(dt, 0.05));
        lastTime = now;

        const dpr = window.devicePixelRatio || 1;
        const width = window.innerWidth;
        const height = window.innerHeight;

        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.scale(dpr, dpr);
        ctx.globalCompositeOperation = config.blendMode;
        ctx.clearRect(0, 0, width, height);

        // Age points (autoFade)
        if (config.autoFade && trailPoints.length) {
            const decay = dt / Math.max(0.001, config.fadeDuration);
            for (let i = trailPoints.length - 1; i >= 0; i--) {
                trailPoints[i].life -= decay;
                if (trailPoints[i].life <= 0) {
                    trailPoints.splice(i, 1);
                }
            }
        }

        if (trailPoints.length < 1) {
            if (config.variant === "particles" && particles.length > 0) {
                updateAndDrawParticles(dt);
                rafId = requestAnimationFrame(animate);
                return;
            }
            isRunning = false;
            return;
        }

        if (config.variant === "dots") {
            for (let i = 0; i < trailPoints.length; i++) {
                const pt = trailPoints[i];
                const t = i / (trailPoints.length - 1 || 1);
                const a = indexAlpha(i, trailPoints.length) * (config.autoFade ? pt.life : 1);
                const r = config.dotSize * (config.fadeOut ? 0.3 + 0.7 * a : 1);
                ctx.fillStyle = rgba(a, t);
                ctx.beginPath();
                ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
                ctx.fill();
            }
        } else if (config.variant === "pixel") {
            for (let i = 0; i < trailPoints.length; i++) {
                let { x, y } = trailPoints[i];
                if (config.snapToGrid) {
                    x = Math.round(x / config.pixelSize) * config.pixelSize;
                    y = Math.round(y / config.pixelSize) * config.pixelSize;
                }
                const t = i / (trailPoints.length - 1 || 1);
                const a = indexAlpha(i, trailPoints.length) * (config.autoFade ? trailPoints[i].life : 1);
                const s = config.pixelSize * (config.fadeOut ? 0.6 + 0.4 * a : 1);
                ctx.fillStyle = rgba(a, t);
                ctx.fillRect(x - s / 2, y - s / 2, s, s);
            }
        } else if (config.variant === "particles") {
            updateAndDrawParticles(dt);
            if (trailPoints.length > 1) {
                for (let i = 1; i < trailPoints.length; i++) {
                    const p1 = trailPoints[i - 1];
                    const p2 = trailPoints[i];
                    const lifeFactor = config.autoFade ? trailPoints[i].life : 1;
                    const a = 0.15 * indexAlpha(i, trailPoints.length) * lifeFactor;
                    ctx.strokeStyle = rgba(a, i / (trailPoints.length - 1 || 1));
                    ctx.lineWidth = Math.max(1, config.lineWidth * 0.5 * a);
                    ctx.lineCap = "round";
                    ctx.lineJoin = "round";
                    ctx.beginPath();
                    ctx.moveTo(p1.x, p1.y);
                    ctx.lineTo(p2.x, p2.y);
                    ctx.stroke();
                }
            }
        } else {
            // Line variant (Framer default)
            if (trailPoints.length < 2) {
                const pt = trailPoints[0];
                const a = config.autoFade ? pt.life : 1;
                ctx.fillStyle = rgba(a, 0);
                ctx.beginPath();
                ctx.arc(pt.x, pt.y, Math.max(1, config.lineWidth / 2), 0, Math.PI * 2);
                ctx.fill();
            } else {
                for (let i = 1; i < trailPoints.length; i++) {
                    const p1 = trailPoints[i - 1];
                    const p2 = trailPoints[i];
                    const t = i / (trailPoints.length - 1 || 1);
                    const lifeFactor = config.autoFade ? trailPoints[i].life : 1;
                    const a = indexAlpha(i, trailPoints.length) * lifeFactor;
                    const widthScale = config.fadeOut ? 0.3 + 0.7 * a : 1;
                    ctx.strokeStyle = rgba(a, t);
                    ctx.lineWidth = Math.max(1, config.lineWidth * widthScale);
                    ctx.lineCap = "round";
                    ctx.lineJoin = "round";
                    ctx.beginPath();
                    ctx.moveTo(p1.x, p1.y);
                    ctx.lineTo(p2.x, p2.y);
                    ctx.stroke();
                }
            }
        }

        rafId = requestAnimationFrame(animate);
    }

    function startLoop() {
        if (!isRunning && isLightMode()) {
            isRunning = true;
            lastTime = performance.now();
            rafId = requestAnimationFrame(animate);
        }
    }

    function stopAndClear() {
        if (rafId) cancelAnimationFrame(rafId);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        trailPoints = [];
        particles = [];
        isRunning = false;
    }

    // Watch for theme toggles
    window.addEventListener('themeChanged', function() {
        if (isLightMode()) {
            startLoop();
        } else {
            stopAndClear();
        }
    });

    const themeObserver = new MutationObserver(function() {
        if (isLightMode()) {
            startLoop();
        } else {
            stopAndClear();
        }
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    if (isLightMode()) {
        startLoop();
    }
}

/* ==========================================================================
   FRAMER PARTICLE TEXT SYSTEM (Robin Hossain)
   Component Source: https://framer.com/m/ParticleText-2NZQ.js@otOSwmqP2acS2BjTve4l
   ========================================================================== */
function initFramerParticleText() {
    const canvas = document.getElementById('hero-particle-text-canvas');
    if (!canvas) return;

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    const text = "Robin Hossain";
    const particleDensity = 2.2; // Dense, crisp letter definition
    const mouseRadius = 95;
    const returnSpeed = 0.065;
    let particles = [];
    let mouse = { x: -2000, y: -2000 };
    let rafId = null;
    let canvasWidth = 0;
    let canvasHeight = 0;

    function buildParticles() {
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) {
            requestAnimationFrame(buildParticles);
            return;
        }

        canvasWidth = rect.width;
        canvasHeight = rect.height;
        canvas.width = Math.round(rect.width * dpr);
        canvas.height = Math.round(rect.height * dpr);

        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, canvasWidth, canvasHeight);

        // Responsive font calculation to fit container cleanly
        const fontFamily = "'Space Grotesk', 'Montserrat', 'Inter', -apple-system, BlinkMacSystemFont, sans-serif";
        const fontWeight = "800";
        let fontSize = Math.min(canvasWidth * 0.115, canvasHeight * 0.74);
        fontSize = Math.max(34, Math.min(fontSize, 84));
        ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
        let metrics = ctx.measureText(text);

        // Adjust font size if text exceeds maximum container width
        const maxTextWidth = canvasWidth * 0.94;
        if (metrics.width > maxTextWidth) {
            fontSize = fontSize * (maxTextWidth / metrics.width);
            ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
        }

        // Render text
        ctx.fillStyle = "#ffffff";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(text, canvasWidth / 2, canvasHeight / 2);

        // Scan pixels
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const pixels = imageData.data;
        particles = [];
        const gap = Math.max(2, Math.round(particleDensity * dpr));

        for (let y = 0; y < canvas.height; y += gap) {
            for (let x = 0; x < canvas.width; x += gap) {
                const index = (y * canvas.width + x) * 4;
                if (pixels[index + 3] > 120) {
                    const px = x / dpr;
                    const py = y / dpr;
                    particles.push({
                        x: px + (Math.random() - 0.5) * 2,
                        y: py + (Math.random() - 0.5) * 2,
                        baseX: px,
                        baseY: py,
                        vx: 0,
                        vy: 0,
                        size: 1.8 + Math.random() * 0.4
                    });
                }
            }
        }

        ctx.clearRect(0, 0, canvasWidth, canvasHeight);
    }

    // Initial build with font load handling
    buildParticles();
    if (document.fonts) {
        document.fonts.ready.then(buildParticles);
    }
    setTimeout(buildParticles, 200);
    setTimeout(buildParticles, 600);

    // Mouse tracking
    function updateMouse(clientX, clientY) {
        const rect = canvas.getBoundingClientRect();
        mouse.x = clientX - rect.left;
        mouse.y = clientY - rect.top;
    }

    window.addEventListener('mousemove', function(e) {
        const rect = canvas.getBoundingClientRect();
        if (e.clientX >= rect.left - 80 && e.clientX <= rect.right + 80 &&
            e.clientY >= rect.top - 80 && e.clientY <= rect.bottom + 80) {
            updateMouse(e.clientX, e.clientY);
        } else {
            mouse.x = -2000;
            mouse.y = -2000;
        }
    }, { passive: true });

    canvas.addEventListener('mouseleave', function() {
        mouse.x = -2000;
        mouse.y = -2000;
    });

    // Touch support for mobile
    window.addEventListener('touchmove', function(e) {
        if (e.touches && e.touches[0]) {
            const touch = e.touches[0];
            const rect = canvas.getBoundingClientRect();
            if (touch.clientX >= rect.left - 40 && touch.clientX <= rect.right + 40 &&
                touch.clientY >= rect.top - 40 && touch.clientY <= rect.bottom + 40) {
                updateMouse(touch.clientX, touch.clientY);
            }
        }
    }, { passive: true });

    window.addEventListener('touchend', function() {
        mouse.x = -2000;
        mouse.y = -2000;
    });

    // Click interactive impulse burst
    canvas.addEventListener('click', function(e) {
        const rect = canvas.getBoundingClientRect();
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;
        for (let i = 0; i < particles.length; i++) {
            const p = particles[i];
            const dx = p.x - cx;
            const dy = p.y - cy;
            const dist = Math.hypot(dx, dy);
            if (dist < 130) {
                const angle = Math.atan2(dy, dx);
                const force = (130 - dist) * 0.16;
                p.vx += Math.cos(angle) * force;
                p.vy += Math.sin(angle) * force;
            }
        }
    });

    // Animation render loop
    function animate() {
        ctx.clearRect(0, 0, canvasWidth, canvasHeight);

        const isLight = document.documentElement.getAttribute('data-theme') === 'light';
        ctx.fillStyle = isLight ? "#0f172a" : "#FFFFFF";

        const count = particles.length;
        for (let i = 0; i < count; i++) {
            const p = particles[i];
            const dx = mouse.x - p.x;
            const dy = mouse.y - p.y;
            const dist = Math.hypot(dx, dy);

            // Push particles away from mouse pointer
            if (dist < mouseRadius) {
                const force = (mouseRadius - dist) / mouseRadius;
                const angle = Math.atan2(dy, dx);
                p.vx -= Math.cos(angle) * force * 3.4;
                p.vy -= Math.sin(angle) * force * 3.4;
            }

            // Return to base position
            p.vx += (p.baseX - p.x) * returnSpeed;
            p.vy += (p.baseY - p.y) * returnSpeed;

            // Velocity damping
            p.vx *= 0.94;
            p.vy *= 0.94;

            p.x += p.vx;
            p.y += p.vy;

            // Draw particle
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            ctx.fill();
        }

        rafId = requestAnimationFrame(animate);
    }

    animate();

    // Rebuild on window resize & theme toggle
    let resizeTimer = null;
    window.addEventListener('resize', function() {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(buildParticles, 120);
    });
    window.addEventListener('themeChanged', function() {
        setTimeout(buildParticles, 50);
    });
}

// Initialize cursor and interactive components when DOM is ready
function initHeroInteractiveComponents() {
    try {
        if (typeof initFramerCursorDotTrail === 'function') {
            initFramerCursorDotTrail();
        }
    } catch (e) {
        console.error('Error initializing cursor dot trail:', e);
    }

    try {
        if (typeof initFramerMouseTrail === 'function') {
            initFramerMouseTrail();
        }
    } catch (e) {
        console.error('Error initializing mouse trail:', e);
    }

    try {
        if (typeof initFramerParticleText === 'function') {
            initFramerParticleText();
        }
    } catch (e) {
        console.error('Error initializing particle text:', e);
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initHeroInteractiveComponents);
} else {
    initHeroInteractiveComponents();
}

// Interactive Preloader functionality
function initPreloader() {
    const preloader = document.getElementById('preloader');
    const loadingMessage = document.getElementById('loadingMessage');
    const progressBar = document.getElementById('progressBar');
    
    // PRELOADER PAUSED - Add preloader-active class to hide scrollbar
    if (window.innerWidth <= 768) {
        document.body.classList.add('preloader-active');
    }
    
    
    
    // Function to trigger bar compression when dot reaches 5th bar
    let barCompressionTriggered = false;
    let lastTriggerTime = 0;
    
    function triggerBarCompression() {
        // Bar compression disabled - bars will not shrink when dot climbs
        return;
    }
    
    // Monitor dot position and trigger bar compression
    let currentBarIndex = -1; // Track which bar the dot is currently on
    let animationStartTime = Date.now();
    
    // Initialize bar colors to ensure consistency across environments
    function initializeBarColors() {
        const bars = document.querySelectorAll('.loader__bar');
        bars.forEach(bar => {
            bar.style.background = '#ffffff';
        });
        currentBarIndex = -1;
    }
    
    // Call initialization immediately
    initializeBarColors();
    
    function monitorDotPosition() {
        const ball = document.querySelector('.loader__ball');
        if (ball) {
            const bars = document.querySelectorAll('.loader__bar');
            const dotColor = '#b6f500'; // Dot color
            const whiteColor = '#ffffff'; // White color for bars
            
            // Calculate animation progress (2.5s cycle)
            const currentTime = Date.now();
            const elapsedTime = (currentTime - animationStartTime) % 2500; // 2.5s cycle
            const progress = (elapsedTime / 2500) * 100; // Progress as percentage
            
            // Determine which bar should be colored based on animation timing
            let newBarIndex = -1;
            
            // Map animation progress to bar positions with more precise timing
            if (progress >= 0 && progress < 16) {
                newBarIndex = 0; // Bar 1 (0% - 16%)
            } else if (progress >= 16 && progress < 34) {
                newBarIndex = 1; // Bar 2 (16% - 34%)
            } else if (progress >= 34 && progress < 52) {
                newBarIndex = 2; // Bar 3 (34% - 52%)
            } else if (progress >= 52 && progress < 70) {
                newBarIndex = 3; // Bar 4 (52% - 70%)
            } else if (progress >= 70 && progress < 100) {
                newBarIndex = 4; // Bar 5 (70% - 100%)
            }
            
            // Enhanced color synchronization for hosted environments
            if (newBarIndex !== -1 && newBarIndex !== currentBarIndex) {
                // Reset all bars to white first for consistency
                bars.forEach((bar, index) => {
                    if (index !== newBarIndex) {
                        bar.style.background = whiteColor;
                    }
                });
                
                // Color the active bar
                if (newBarIndex >= 0 && newBarIndex < bars.length) {
                    bars[newBarIndex].style.background = dotColor;
                }
                
                currentBarIndex = newBarIndex;
            }
            
            // Trigger bar compression at the end of the cycle
            if (progress >= 80 && progress < 85) {
                triggerBarCompression();
            }
        }
    }
    
    // Set up monitoring with higher frequency for better precision and consistency
    setInterval(monitorDotPosition, 30); // Increased frequency for better sync
    
    
    
    // Loading time-based text reveal system
    function showTextBasedOnLoadingTime() {
        const currentTime = Date.now();
        const elapsedTime = currentTime - preloaderStartTime;
        
        // Show loading message after 3 seconds of actual loading
        if (elapsedTime >= 3000 && !loadingMessage.classList.contains('show')) {
            if (loadingMessage) {
                loadingMessage.classList.add('show');
                
                // Animate loading message text line by line
                const messagePart1 = loadingMessage.querySelector('.message-part-1');
                if (messagePart1) {
                    const textLines = messagePart1.querySelectorAll('.text-line');
                    textLines.forEach((line, index) => {
                        const delay = parseFloat(line.getAttribute('data-delay')) * 1000;
                        setTimeout(() => {
                            line.classList.add('show');
                        }, delay);
                    });
                }
                
                // Animate second message after 2 seconds delay
                setTimeout(() => {
                    const messagePart2 = loadingMessage.querySelector('.message-part-2');
                    if (messagePart2) {
                        const blurTextLines = messagePart2.querySelectorAll('.blur-text-line');
                        blurTextLines.forEach((line, index) => {
                            const delay = parseFloat(line.getAttribute('data-delay')) * 1000;
                            setTimeout(() => {
                                line.classList.add('show');
                            }, delay);
                        });
                    }
                }, 2000);
                
                console.log('Loading message shown after', elapsedTime, 'ms of loading');
            }
        }
        
        
        

    }
    
    // Check loading time every 100ms
    const loadingTimeInterval = setInterval(showTextBasedOnLoadingTime, 100);
    

    
    // Progress bar animation
    let progress = 0;
    const progressInterval = setInterval(() => {
        progress += Math.random() * 15;
        if (progress > 90) progress = 90; // Don't complete until ready
        
        if (progressBar) {
            progressBar.style.width = progress + '%';
        }
    }, 200);
    
    // Function to check if all resources are loaded
    function checkAllResourcesLoaded() {
        return new Promise((resolve) => {
            console.log('Starting comprehensive resource loading check...');
            
            // Enhanced image loading check for hosted environments
            const images = document.querySelectorAll('img');
            console.log(`Found ${images.length} images to load`);
            const imagePromises = Array.from(images).map(img => {
                return new Promise(resolve => {
                    const imgSrc = img.src || img.alt || 'unnamed';
                    
                    // Check if image is already loaded
                    if (img.complete && img.naturalHeight !== 0 && img.naturalWidth !== 0) {
                        console.log(`Image already loaded: ${imgSrc}`);
                        resolve();
                    } else {
                        console.log(`Waiting for image to load: ${imgSrc}`);
                        
                        // Multiple event listeners for better reliability
                        const imageLoaded = () => {
                            console.log(`Image loaded: ${imgSrc}`);
                            resolve();
                        };
                        
                        img.addEventListener('load', imageLoaded);
                        img.addEventListener('error', () => {
                            console.log(`Image failed to load: ${imgSrc}`);
                            resolve(); // Continue even if image fails
                        });
                        
                        // Force image loading if it hasn't started
                        if (!img.complete) {
                            img.src = img.src; // Trigger loading
                        }
                    }
                });
            });
            
            // Enhanced video loading check for hosted environments
            const videos = document.querySelectorAll('video');
            console.log(`Found ${videos.length} videos to load`);
            const videoPromises = Array.from(videos).map(video => {
                return new Promise(resolve => {
                    const videoSrc = video.querySelector('source')?.src || video.src || 'unnamed';
                    console.log(`Checking video: ${videoSrc}, readyState: ${video.readyState}`);
                    
                    // Enhanced video readiness check for hosted environments
                    const checkVideoReady = () => {
                        console.log(`Video ready: ${videoSrc}, readyState: ${video.readyState}`);
                        resolve();
                    };
                    
                    // Check if video is already loaded enough to play
                    if (video.readyState >= 4) { // HAVE_ENOUGH_DATA - fully loaded
                        console.log(`Video already fully ready: ${videoSrc}`);
                        resolve();
                    } else if (video.readyState >= 3) { // HAVE_FUTURE_DATA - enough data to play
                        console.log(`Video has enough data: ${videoSrc}`);
                        // Wait a bit more for better stability
                        setTimeout(() => {
                            console.log(`Video ready after delay: ${videoSrc}`);
                            resolve();
                        }, 500);
                    } else {
                        console.log(`Waiting for video to be ready: ${videoSrc}`);
                        
                        // Multiple event listeners for better reliability
                        video.addEventListener('canplay', checkVideoReady);
                        video.addEventListener('canplaythrough', checkVideoReady);
                        video.addEventListener('loadeddata', checkVideoReady);
                        video.addEventListener('loadedmetadata', checkVideoReady);
                        video.addEventListener('progress', () => {
                            if (video.readyState >= 3) {
                                console.log(`Video ready via progress: ${videoSrc}`);
                                resolve();
                            }
                        });
                        video.addEventListener('error', () => {
                            console.log(`Video failed to load: ${videoSrc}`);
                            resolve(); // Continue even if video fails
                        });
                        
                        // Force video to start loading if it hasn't already
                        if (video.readyState === 0) {
                            video.load();
                        }
                        
                        // Additional timeout for video loading
                        setTimeout(() => {
                            if (video.readyState >= 2) {
                                console.log(`Video ready via timeout: ${videoSrc}`);
                                resolve();
                            }
                        }, 5000);
                    }
                });
            });
            
            // Check if all external resources are loaded
            const externalResources = [
                'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css',
                'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@700&display=swap',
                'https://fonts.googleapis.com/css2?family=Fuzzy+Bubbles:wght@700&display=swap',
                'https://fonts.googleapis.com/css2?family=La+Belle+Aurore&display=swap',
                'https://cdn.jsdelivr.net/npm/particles.js@2.0.0/particles.min.js'
            ];
            
            console.log(`Checking ${externalResources.length} external resources`);
            const resourcePromises = externalResources.map(url => {
                return new Promise(resolve => {
                    console.log(`Checking external resource: ${url}`);
                    const link = document.createElement('link');
                    link.rel = 'preload';
                    link.href = url;
                    link.onload = () => {
                        console.log(`External resource loaded: ${url}`);
                        resolve();
                    };
                    link.onerror = () => {
                        console.log(`External resource failed: ${url}`);
                        resolve(); // Continue even if resource fails
                    };
                    document.head.appendChild(link);
                });
            });
            
            // Check if all fonts are loaded
            const fontPromises = [];
            if (document.fonts && document.fonts.ready) {
                console.log('Checking font loading...');
                fontPromises.push(
                    document.fonts.ready.then(() => {
                        console.log('All fonts loaded');
                    })
                );
            } else {
                console.log('Font loading API not available, skipping font check');
            }
            
            // Additional checks for hosted environments
            const additionalChecks = [];
            
            // Check if all CSS is loaded
            const styleSheets = Array.from(document.styleSheets);
            console.log(`Found ${styleSheets.length} stylesheets`);
            styleSheets.forEach((sheet, index) => {
                additionalChecks.push(
                    new Promise(resolve => {
                        try {
                            // Try to access CSS rules to ensure stylesheet is loaded
                            const rules = sheet.cssRules || sheet.rules;
                            console.log(`Stylesheet ${index} loaded with ${rules?.length || 0} rules`);
                            resolve();
                        } catch (e) {
                            console.log(`Stylesheet ${index} failed to load, continuing...`);
                            resolve(); // Continue even if stylesheet fails
                        }
                    })
                );
            });
            
            // Check if critical JavaScript is loaded
            additionalChecks.push(
                new Promise(resolve => {
                    // Check if particles.js is loaded
                    if (typeof window.particlesJS !== 'undefined') {
                        console.log('Particles.js loaded');
                        resolve();
                    } else {
                        console.log('Waiting for particles.js...');
                        setTimeout(() => {
                            console.log('Particles.js check complete');
                            resolve();
                        }, 1000);
                    }
                })
            );
            
            // Wait for all resources to load
            Promise.all([...imagePromises, ...videoPromises, ...resourcePromises, ...fontPromises, ...additionalChecks])
                .then(() => {
                    console.log('All resources loaded, waiting additional time for stability...');
                    // Extended delay for hosted environments
                    setTimeout(() => {
                        console.log('Resource loading check complete');
                        resolve();
                    }, 2000);
                });
        });
    }
    
    // Function to complete loading and hide preloader
    function completeLoading() {
        clearInterval(progressInterval);
        if (progressBar) {
            progressBar.style.width = '100%';
        }
        
        
        
        // Hide preloader
        setTimeout(() => {
            preloader.classList.add('fade-out');
            setTimeout(() => {
                preloader.style.display = 'none';
                // PRELOADER PAUSED - document.body.classList.add('loaded');
                if (window.innerWidth <= 768) {
                    document.body.classList.remove('preloader-active');
                }
            
                // Removed automatic scroll-to-top on fresh page load to preserve
                // the user's current scroll position after the preloader hides.
            
                // Animate hero content
            setTimeout(() => {
                document.querySelectorAll('.hero-content > *').forEach((el, index) => {
                    el.style.animationDelay = `${index * 0.2}s`;
                    el.classList.add('fade-in');
                });
            }, 100);
        }, 500);
        }, 1000);
    }
    
    // Wait specifically for the hero background video to be ready.
    // This keeps the preloader visible only as long as the hero video needs to load,
    // reducing unnecessary waiting for other resources.
    (function waitForHeroVideoAndLoad() {
        const heroVideo = document.querySelector('.hero-video-background');
        if (!heroVideo) {
            // If no hero video found, fall back to original comprehensive loading check
            Promise.all([
                new Promise(resolve => {
                    if (document.readyState === 'complete') {
                        console.log('Document already fully loaded');
                        resolve();
                    } else {
                        console.log('Waiting for window load event...');
                        window.addEventListener('load', () => {
                            console.log('Window load event fired');
                            resolve();
                        });
                    }
                }),
                checkAllResourcesLoaded()
            ]).then(() => {
                console.log('No hero video: resources loaded, completing preloader');
                completeLoading();
            });
            return;
        }

        // Resolve when the video is ready to play through or has enough data
        const heroReadyPromise = new Promise(resolve => {
            function onReady() {
                cleanup();
                console.log('Hero video ready:', heroVideo.readyState);
                resolve();
            }
            function onError() {
                cleanup();
                console.warn('Hero video failed to load or errored; proceeding');
                resolve();
            }
            function cleanup() {
                heroVideo.removeEventListener('canplaythrough', onReady);
                heroVideo.removeEventListener('canplay', onReady);
                heroVideo.removeEventListener('loadeddata', onReady);
                heroVideo.removeEventListener('loadedmetadata', onReady);
                heroVideo.removeEventListener('error', onError);
            }

            // If already in a good readyState, resolve immediately
            if (heroVideo.readyState >= 3) { // HAVE_FUTURE_DATA or better
                console.log('Hero video already has sufficient data (readyState >= 3)');
                resolve();
                return;
            }

            heroVideo.addEventListener('canplaythrough', onReady, { once: true });
            heroVideo.addEventListener('canplay', onReady, { once: true });
            heroVideo.addEventListener('loadeddata', onReady, { once: true });
            heroVideo.addEventListener('loadedmetadata', onReady, { once: true });
            heroVideo.addEventListener('error', onError, { once: true });

            // Safety timeout: if the video takes too long, proceed after 2.5s
            setTimeout(() => {
                console.warn('Hero video wait timed out; proceeding');
                cleanup();
                resolve();
            }, 2500);
        });

        // Also wait for the window load event in parallel but prefer video readiness
        const windowLoadPromise = new Promise(resolve => {
            if (document.readyState === 'complete') resolve();
            else window.addEventListener('load', () => resolve(), { once: true });
        });

        Promise.all([heroReadyPromise, windowLoadPromise]).then(() => {
            console.log('Hero video ready and window loaded (or timed out), completing preloader');
            completeLoading();
        });
    })();
    
    // Fallback: Complete loading after maximum 3.5 seconds
    setTimeout(() => {
        console.log('Fallback: Completing preloader after timeout');
        completeLoading();
    }, 3500);
}

/* Mobile-only metadata items are now displayed via CSS media queries. 
   The DOM removal function has been removed to allow the items to render on mobile. */

// Initialize preloader when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    // PRELOADER PAUSED - Commented out for now, can be re-enabled later
    // initPreloader();
    
    // Initialize the preloader flow so it remains until all resources
    // (including the hero background video) are fully ready to play.
    initPreloader();
    
    console.log('particles.js test:', typeof window.particlesJS);
    // Remove the following lines to eliminate the background particle effect only:
    // const networkParticles = new NetworkParticles('networkCanvas');
    // window.networkParticles = networkParticles;
    
    // Optimize for mobile performance
    if (window.innerWidth <= 768) {
        const particleCount = window.innerWidth <= 480 ? 30 : 50;
        initHeroParticles(particleCount);
    } else {
        initHeroParticles();
    }
    
    // Initialize background particles
    initBackgroundParticles();
    
    // Initialize KokonutUI Shape Hero footer animation
    initKokonutShapeHeroFooter();
    
    initNavigation();
    initKineticTextSwapper();
    initPrismGradient();
    initScrollAnimations();
    initStickyHeader();
    initProfileImageTransition();
    initScrollToTopButton();
    animateHeroParticles();
    animateBackgroundParticles();
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            const target = document.querySelector(this.getAttribute('href'));
            if (target) {
                // If this is a nav link, update active state and underline immediately
                if (this.classList.contains('nav-link')) {
                    // Remove active from all nav links
                    document.querySelectorAll('.nav-link').forEach(link => {
                        link.classList.remove('active');
                    });
                    // Add active to clicked link
                    this.classList.add('active');
                    // Update underline immediately (desktop only)
                    if (window.innerWidth > 1024) {
                        updateNavIndicator(this);
                    }
                }
                // Smooth scroll to target with consistent offset (desktop only)
                if (window.innerWidth > 1024) {
                    // Special handling for Home section - scroll to top
                    if (target.id === 'home' || target.classList.contains('hero-section')) {
                        window.scrollTo({
                            top: 0,
                            behavior: 'smooth'
                        });
                    } else {
                        // Calculate navbar height
                        const navbar = document.getElementById('navbar');
                        const navbarHeight = navbar ? navbar.offsetHeight : 70;
                        
                        // Find section title within the target section for consistent spacing
                        const sectionTitle = target.querySelector('.section-title');
                        let targetElement = sectionTitle || target;
                        
                        // Calculate position: section title top + current scroll - navbar height
                        const targetRect = targetElement.getBoundingClientRect();
                        const targetPosition = targetRect.top + window.pageYOffset - navbarHeight;
                        
                        window.scrollTo({
                            top: targetPosition,
                            behavior: 'smooth'
                        });
                    }
                } else {
                    // Mobile: use default scrollIntoView
                    if (target.id === 'home' || target.classList.contains('hero-section')) {
                        window.scrollTo({
                            top: 0,
                            behavior: 'smooth'
                        });
                    } else {
                        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }
                }
            }
        });
    });

    // Scroll indicator show/hide logic
    const scrollIndicator = document.querySelector('.scroll-indicator');
    const heroSection = document.querySelector('.hero-section');
    function toggleScrollIndicator() {
        if (!scrollIndicator || !heroSection) return;
        const heroBottom = heroSection.getBoundingClientRect().bottom;
        if (heroBottom <= 0) {
            scrollIndicator.classList.add('scroll-indicator--visible');
        } else {
            scrollIndicator.classList.remove('scroll-indicator--visible');
        }
    }
    window.addEventListener('scroll', toggleScrollIndicator);
    toggleScrollIndicator(); // Initial check

    // Quote Rotator for Favorite Quote section
    const quotes = [
        {
            text: `Every one of us is, in the cosmic perspective, precious. If a human disagrees with you, let him live. In a hundred billion galaxies, you will not find another.`,
            author: 'Carl Sagan'
        },
        {
            text: `If you're brave enough to say goodbye, life will reward you with a new hello.`,
            author: 'Paulo Coelho'
        },
        {
            text: `Nothing is impossible. Because 'impossible' says that "I-m-possible.`,
            author: 'Audrey Hepburn'
        },
        {
            text: `What are you afraid of losing when nothing in the world actually belongs to you?`,
            author: 'Marcus Aurelius'
        },
        {
            text: `Everything that happens helps you grow, even if it’s hard to see right now.`,
            author: 'Austin Mahone'
        }
    ];
    const quoteText = document.querySelector('.quote-text');
    const authorName = document.querySelector('.author-name');
    let quoteIndex = 0;
    function showQuote(index) {
        if (!quoteText || !authorName) return;
        // Fade out
        quoteText.style.transition = 'opacity 0.7s';
        authorName.style.transition = 'opacity 0.7s';
        quoteText.style.opacity = 0;
        authorName.style.opacity = 0;
        setTimeout(() => {
            quoteText.textContent = '"' + quotes[index].text + '"';
            authorName.textContent = quotes[index].author;
            // Add/remove special class for Carl Sagan quote (index 0) so we
            // can apply a different mobile-only rule for that one quote.
            if (index === 0) {
                quoteText.classList.add('quote--sagan');
            } else {
                quoteText.classList.remove('quote--sagan');
            }
            // Fade in
            quoteText.style.opacity = 1;
            authorName.style.opacity = 1;
        }, 700);
    }
    setInterval(() => {
        quoteIndex = (quoteIndex + 1) % quotes.length;
        showQuote(quoteIndex);
    }, 10000);
    // Initialize with the first quote (which matches the HTML)
    showQuote(0);

    // Sticky navbar scroll effect
    const navbar = document.getElementById('navbar');
    function handleNavbarScroll() {
        if (!navbar) return;
        if (window.scrollY > 0) {
            navbar.classList.add('scrolled');
        } else {
            navbar.classList.remove('scrolled');
        }
    }
    window.addEventListener('scroll', handleNavbarScroll);
    handleNavbarScroll(); // Initial check

    // Initialize desktop nav underline indicator
    updateNavIndicator();
    window.addEventListener('resize', debounce(updateNavIndicator, 150));
    window.addEventListener('load', updateNavIndicator);
    // Real-time sync on scroll using rAF (desktop only)
    let navIndicatorRafPending = false;
    function scheduleNavIndicatorUpdate() {
        if (navIndicatorRafPending) return;
        navIndicatorRafPending = true;
        requestAnimationFrame(() => {
            navIndicatorRafPending = false;
            // Skip scroll-driven updates while a desktop click lock is active
            if (window.innerWidth > 1024) {
                if (Date.now() < __navIndicatorLockUntil) return;
                updateNavIndicator();
            }
        });
    }
    window.addEventListener('scroll', scheduleNavIndicatorUpdate, { passive: true });
    // Move indicator on desktop nav clicks immediately
    const desktopNavLinks = document.querySelectorAll('#navbar .nav-container .nav-links .nav-link');
    desktopNavLinks.forEach(link => {
        link.addEventListener('click', function() {
            if (window.innerWidth > 1024) {
                desktopNavLinks.forEach(l => l.classList.remove('active'));
                this.classList.add('active');
                // Lock indicator to the clicked link to prevent bounce-back during smooth scroll
                __navIndicatorLockUntil = Date.now() + 900;
                __desktopLastActiveLink = this;
                updateNavIndicator(this);
            }
        });
    });

    // Initialize Framer floating pill hover effect
    initFloatingPillHover();

    // Initialize Framer Text Video Mask
    initTextVideoMask();
});

function initStickyHeader() {
    const navbar = document.getElementById('navbar');
    const navLogo = document.querySelector('.nav-logo');
    if (!navbar || !navLogo) return;
    window.addEventListener('scroll', () => {
        if (window.pageYOffset > 50) {
            navLogo.classList.add('wave-active');
            navbar.classList.add('scrolled');
        } else {
            navLogo.classList.remove('wave-active');
            navbar.classList.remove('scrolled');
        }
    }, { passive: true });
}

// Hero Particle Class
class Particle {
    constructor(canvas) {
        this.canvas = canvas;
        this.x = Math.random() * canvas.width;
        this.y = Math.random() * canvas.height;
        this.vx = (Math.random() - 0.5) * 1;
        this.vy = (Math.random() - 0.5) * 1;
        this.size = Math.random() * 3 + 1;
        this.opacity = Math.random() * 0.8 + 0.2;
    }
    
    update() {
        this.x += this.vx;
        this.y += this.vy;
        
        // Bounce off edges
        if (this.x <= 0 || this.x >= this.canvas.width) this.vx *= -1;
        if (this.y <= 0 || this.y >= this.canvas.height) this.vy *= -1;
    }
    
    draw(ctx) {
        ctx.save();
        ctx.globalAlpha = this.opacity;
        ctx.fillStyle = '#8b5cf6';
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
}

function initHeroParticles(particleCount = 30) {
    const canvas = document.getElementById('heroParticleCanvas');
    const heroContent = document.querySelector('.hero-content');
    if (!canvas || !heroContent) return;
    function resizeCanvas() {
        canvas.width = heroContent.clientWidth;
        canvas.height = heroContent.clientHeight;
        heroParticles = [];
        for (let i = 0; i < particleCount; i++) {
            heroParticles.push(new Particle(canvas));
        }
    }
    resizeCanvas();
    window.addEventListener('resize', debounce(resizeCanvas, 250));
}

function animateHeroParticles() {
    const canvas = document.getElementById('heroParticleCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    // Draw connecting lines
    for (let i = 0; i < heroParticles.length; i++) {
        for (let j = i + 1; j < heroParticles.length; j++) {
            const dx = heroParticles[i].x - heroParticles[j].x;
            const dy = heroParticles[i].y - heroParticles[j].y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            if (distance < 100) {
                ctx.save();
                ctx.globalAlpha = 0.22 * (1 - distance / 100);
                ctx.beginPath();
                ctx.moveTo(heroParticles[i].x, heroParticles[i].y);
                ctx.lineTo(heroParticles[j].x, heroParticles[j].y);
                ctx.strokeStyle = '#8b5cf6';
                ctx.lineWidth = 1.1;
                ctx.stroke();
                ctx.restore();
            }
        }
    }
    for (let i = 0; i < heroParticles.length; i++) {
        heroParticles[i].update();
        heroParticles[i].draw(ctx);
    }
    requestAnimationFrame(animateHeroParticles);
}

// Background Particle System
function initBackgroundParticles() {
    backgroundCanvas = document.getElementById('particleBackground');
    if (!backgroundCanvas) return;
    
    backgroundCtx = backgroundCanvas.getContext('2d');
    if (!backgroundCtx) return;
    
    function resizeBackgroundCanvas() {
        backgroundCanvas.width = window.innerWidth;
        backgroundCanvas.height = window.innerHeight;
        
        // Clear existing particles
        backgroundParticles = [];
        
        // Create particles based on screen size
        const particleCount = Math.min(60, Math.floor((window.innerWidth * window.innerHeight) / 18000));
        
        for (let i = 0; i < particleCount; i++) {
            backgroundParticles.push(new BackgroundParticle(backgroundCanvas));
        }
    }
    
    resizeBackgroundCanvas();
    window.addEventListener('resize', debounce(resizeBackgroundCanvas, 250));
}

function animateBackgroundParticles() {
    if (!backgroundCanvas || !backgroundCtx) return;
    
    // Check if we're in footer section and hide particles if so
    const footer = document.querySelector('.footer');
    if (footer) {
        const footerTop = footer.offsetTop;
        const footerBottom = footerTop + footer.offsetHeight;
        const scrollPosition = window.scrollY;
        const windowHeight = window.innerHeight;
        const windowMiddle = scrollPosition + (windowHeight / 2);
        
        // If in footer section, hide the entire canvas element
        if (windowMiddle >= footerTop && windowMiddle <= footerBottom) {
            backgroundCanvas.style.opacity = '0';
            backgroundCanvas.style.visibility = 'hidden';
            requestAnimationFrame(animateBackgroundParticles);
            return;
        } else {
            // Show the canvas when not in footer
            backgroundCanvas.style.opacity = '1';
            backgroundCanvas.style.visibility = 'visible';
        }
    }
    
    const w = backgroundCanvas.width;
    const h = backgroundCanvas.height;
    backgroundCtx.clearRect(0, 0, w, h);
    // Draw connecting lines between particles
    for (let i = 0; i < backgroundParticles.length; i++) {
        for (let j = i + 1; j < backgroundParticles.length; j++) {
            const dx = backgroundParticles[i].x - backgroundParticles[j].x;
            const dy = backgroundParticles[i].y - backgroundParticles[j].y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            if (distance < 90) {
                backgroundCtx.save();
                backgroundCtx.globalAlpha = 0.13 * (1 - distance / 90);
                backgroundCtx.beginPath();
                backgroundCtx.moveTo(backgroundParticles[i].x, backgroundParticles[i].y);
                backgroundCtx.lineTo(backgroundParticles[j].x, backgroundParticles[j].y);
                backgroundCtx.strokeStyle = '#8b5cf6';
                backgroundCtx.lineWidth = 1.1;
                backgroundCtx.stroke();
                backgroundCtx.restore();
            }
        }
    }
    // Draw lines to mouse on hover
    if (mousePos.x !== null && mousePos.y !== null) {
        for (let i = 0; i < backgroundParticles.length; i++) {
            const dx = backgroundParticles[i].x - mousePos.x;
            const dy = backgroundParticles[i].y - mousePos.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            if (distance < 120) {
                backgroundCtx.save();
                backgroundCtx.globalAlpha = 0.18 * (1 - distance / 120);
                backgroundCtx.beginPath();
                backgroundCtx.moveTo(backgroundParticles[i].x, backgroundParticles[i].y);
                backgroundCtx.lineTo(mousePos.x, mousePos.y);
                backgroundCtx.strokeStyle = '#8b5cf6';
                backgroundCtx.lineWidth = 1.2;
                backgroundCtx.stroke();
                backgroundCtx.restore();
            }
        }
    }
    // Draw particles
    for (let i = 0; i < backgroundParticles.length; i++) {
        backgroundParticles[i].update();
        backgroundParticles[i].draw(backgroundCtx);
    }
    requestAnimationFrame(animateBackgroundParticles);
}

// Mouse tracking for background canvas
if (typeof window !== 'undefined') {
    window.addEventListener('mousemove', function(e) {
        if (!backgroundCanvas) return;
        const rect = backgroundCanvas.getBoundingClientRect();
        mousePos.x = e.clientX - rect.left;
        mousePos.y = e.clientY - rect.top;
    });
    window.addEventListener('mouseleave', function() {
        mousePos.x = null;
        mousePos.y = null;
    });
}

// Background Particle Class
class BackgroundParticle {
    constructor(canvas) {
        this.canvas = canvas;
        this.x = Math.random() * canvas.width;
        this.y = Math.random() * canvas.height;
        // Always have a base velocity for natural movement
        this.baseVx = (Math.random() - 0.5) * 0.3;
        this.baseVy = (Math.random() - 0.5) * 0.3;
        this.vx = this.baseVx;
        this.vy = this.baseVy;
        this.size = Math.random() * 1.5 + 0.7;
        this.opacity = Math.random() * 0.3 + 0.1;
    }
    update() {
        // Only natural movement
        this.vx += (this.baseVx - this.vx) * 0.01;
        this.vy += (this.baseVy - this.vy) * 0.01;
        this.x += this.vx;
        this.y += this.vy;
        this.vx *= 0.98;
        this.vy *= 0.98;
        if (this.x < 0) this.x = this.canvas.width;
        if (this.x > this.canvas.width) this.x = 0;
        if (this.y < 0) this.y = this.canvas.height;
        if (this.y > this.canvas.height) this.y = 0;
    }
    draw(ctx) {
        ctx.save();
        ctx.globalAlpha = this.opacity;
        ctx.fillStyle = '#8b5cf6';
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
}

function initNavigation() {
    const hamburger = document.querySelector('.nav-hamburger');
    const mobileMenu = document.querySelector('.mobile-menu');
    const navLinks = document.querySelectorAll('.nav-link');
    
    // Ensure mobile menu starts closed
    if (mobileMenu) {
        mobileMenu.classList.remove('active');
    }
    
    if (hamburger && mobileMenu) {
        hamburger.addEventListener('click', () => {
            isMenuOpen = !isMenuOpen;
            hamburger.classList.toggle('active');
            mobileMenu.classList.toggle('active');
            document.body.classList.toggle('no-scroll');
        });
        
        document.querySelectorAll('.mobile-menu .nav-link').forEach(link => {
            link.addEventListener('click', () => {
                isMenuOpen = false;
                hamburger.classList.remove('active');
                mobileMenu.classList.remove('active');
                document.body.classList.remove('no-scroll');
            });
        });

        // Close mobile menu when clicking outside of drawer and hamburger
        document.addEventListener('click', (e) => {
            if (isMenuOpen && mobileMenu.classList.contains('active')) {
                if (!mobileMenu.contains(e.target) && !hamburger.contains(e.target)) {
                    isMenuOpen = false;
                    hamburger.classList.remove('active');
                    mobileMenu.classList.remove('active');
                    document.body.classList.remove('no-scroll');
                }
            }
        });
    }
    window.addEventListener('scroll', () => {
        const sections = ['home', 'about', 'experience', 'education', 'skills', 'projects', 'portfolio', 'contact'];
        let current = '';
        
        // Desktop-only: Use navbar height for consistent detection (matches click event trigger point)
        const isDesktop = window.innerWidth > 1024;
        const navbar = document.getElementById('navbar');
        const navbarHeight = isDesktop && navbar ? navbar.offsetHeight : 70;
        const thresholdY = navbarHeight; // desktop detection line aligned with click offset
        const scrollThreshold = isDesktop ? thresholdY : 100; // Desktop: use thresholdY, Mobile: use 100px
        
        // While a desktop click lock is active, skip scroll-driven nav updates to prevent bounce
        if (isDesktop && Date.now() < __navIndicatorLockUntil) {
            return;
        }
        
        // Desktop: Viewport-based detection with early exact detection-line match (aligned with click offset)
        if (isDesktop) {
            // Special handling for Home - if at top of page, always Home
            if (window.pageYOffset <= 50) {
                current = 'home';
            } else {
                const viewportTop = navbarHeight;
                const viewportBottom = window.innerHeight;
                const viewportMiddle = viewportTop + (viewportBottom - viewportTop) / 2;
                
                // Define all sections with their associated subsections
                const sectionGroups = [
                    {
                        id: 'home',
                        main: document.getElementById('home'),
                        subsections: []
                    },
                    {
                        id: 'about',
                        main: document.getElementById('about'),
                        subsections: [document.querySelector('.stats-section')]
                    },
                    {
                        id: 'experience',
                        main: document.getElementById('experience'),
                        subsections: [document.getElementById('experience')?.querySelector('.container')?.querySelector('.achievements-section')]
                    },
                    {
                        id: 'education',
                        main: document.getElementById('education'),
                        subsections: []
                    },
                    {
                        id: 'skills',
                        main: document.getElementById('skills'),
                        subsections: [
                            document.getElementById('other-skills'),
                            document.getElementById('language-proficiency')
                        ]
                    },
                    {
                        id: 'projects',
                        main: document.getElementById('projects'),
                        subsections: []
                    },
                    {
                        id: 'portfolio',
                        main: document.getElementById('portfolio'),
                        subsections: [document.getElementById('about-myself')]
                    },
                    {
                        id: 'contact',
                        main: document.getElementById('contact'),
                        subsections: [
                            document.getElementById('quote'),
                            document.querySelector('.footer')
                        ]
                    }
                ];
                
                // EARLY CHECK: Use single detection line equal to navbar bottom (matches click offset)
                const detectionY = thresholdY;
                for (const group of sectionGroups) {
                    if (!group.main) continue;
                    const rect = group.main.getBoundingClientRect();
                    if (rect.top <= detectionY && rect.bottom > detectionY) {
                        current = group.id;
                        break;
                    }
                }
                if (!current) {
                    for (const group of sectionGroups) {
                        for (const sub of group.subsections) {
                            if (!sub) continue;
                            const rect = sub.getBoundingClientRect();
                            if (rect.top <= detectionY && rect.bottom > detectionY) {
                                current = group.id;
                                break;
                            }
                        }
                        if (current) break;
                    }
                }
                
                // Fallback: choose closest section relative to detection line to avoid jitter
                if (!current) {
                    let bestAbove = null; // latest section whose top is at/above the line
                    let bestAboveTop = -Infinity;
                    let bestBelow = null; // earliest section below the line
                    let bestBelowTop = Infinity;
                    
                    for (const group of sectionGroups) {
                        if (!group.main) continue;
                        const rect = group.main.getBoundingClientRect();
                        if (rect.top <= detectionY) {
                            if (rect.top > bestAboveTop) {
                                bestAboveTop = rect.top;
                                bestAbove = group.id;
                            }
                        } else {
                            if (rect.top < bestBelowTop) {
                                bestBelowTop = rect.top;
                                bestBelow = group.id;
                            }
                        }
                        // evaluate subsections similarly
                        for (const sub of group.subsections) {
                            if (!sub) continue;
                            const srect = sub.getBoundingClientRect();
                            if (srect.top <= detectionY) {
                                if (srect.top > bestAboveTop) {
                                    bestAboveTop = srect.top;
                                    bestAbove = group.id;
                                }
                            } else {
                                if (srect.top < bestBelowTop) {
                                    bestBelowTop = srect.top;
                                    bestBelow = group.id;
                                }
                            }
                        }
                    }
                    current = bestAbove || bestBelow || 'home';
                }
            }
        } else {
            // Mobile: Use original logic
            // Check all main sections and subsections
            // Hero section → Home
            const homeSection = document.getElementById('home');
            if (homeSection) {
                // If at the very top of the page, set Home as active
                if (window.pageYOffset <= 50) {
                    current = 'home';
                } else {
                    const rect = homeSection.getBoundingClientRect();
                    if (rect.top <= scrollThreshold && rect.bottom >= scrollThreshold) {
                        current = 'home';
                    }
                }
            }
            
            // About section + Stats section → About
            const aboutSection = document.getElementById('about');
            const statsSection = document.querySelector('.stats-section');
            let isInAbout = false;
            if (aboutSection) {
                const rect = aboutSection.getBoundingClientRect();
                if (rect.top <= scrollThreshold && rect.bottom >= scrollThreshold) {
                    isInAbout = true;
                    current = 'about';
                }
            }
            if (statsSection && !isInAbout) {
                const rect = statsSection.getBoundingClientRect();
                if (rect.top <= scrollThreshold && rect.bottom >= scrollThreshold) {
                    current = 'about';
                }
            }
            
            // Experience section + Here's What I'm Doing → Experience
            const experienceSection = document.getElementById('experience');
            const experienceContainer = experienceSection ? experienceSection.querySelector('.container') : null;
            const heresWhatImDoingSection = experienceContainer ? experienceContainer.querySelector('.achievements-section') : null;
            let isInExperience = false;
            if (experienceSection) {
                const rect = experienceSection.getBoundingClientRect();
                if (rect.top <= scrollThreshold && rect.bottom >= scrollThreshold) {
                    isInExperience = true;
                    current = 'experience';
                }
            }
            if (heresWhatImDoingSection && !isInExperience) {
                const rect = heresWhatImDoingSection.getBoundingClientRect();
                if (rect.top <= scrollThreshold && rect.bottom >= scrollThreshold) {
                    current = 'experience';
                }
            }
            
            // Education section → Education
            const educationSection = document.getElementById('education');
            if (educationSection) {
                const rect = educationSection.getBoundingClientRect();
                if (rect.top <= scrollThreshold && rect.bottom >= scrollThreshold) {
                    current = 'education';
                }
            }
            
            // Skills section + Other Skills + Language Proficiency → Skills
            const skillsSection = document.getElementById('skills');
            const otherSkillsSection = document.getElementById('other-skills');
            const languageProficiencySection = document.getElementById('language-proficiency');
            let isInSkills = false;
            if (skillsSection) {
                const rect = skillsSection.getBoundingClientRect();
                if (rect.top <= scrollThreshold && rect.bottom >= scrollThreshold) {
                    isInSkills = true;
                    current = 'skills';
                }
            }
            if (otherSkillsSection && !isInSkills) {
                const rect = otherSkillsSection.getBoundingClientRect();
                if (rect.top <= scrollThreshold && rect.bottom >= scrollThreshold) {
                    current = 'skills';
                }
            }
            if (languageProficiencySection && !isInSkills) {
                const rect = languageProficiencySection.getBoundingClientRect();
                if (rect.top <= scrollThreshold && rect.bottom >= scrollThreshold) {
                    current = 'skills';
                }
            }
            
            // Projects section → Projects
            const projectsSection = document.getElementById('projects');
            if (projectsSection) {
                const rect = projectsSection.getBoundingClientRect();
                if (rect.top <= scrollThreshold && rect.bottom >= scrollThreshold) {
                    current = 'projects';
                }
            }
            
            // Portfolio section + About Myself → Portfolio
            const portfolioSection = document.getElementById('portfolio');
            const aboutMyselfSection = document.getElementById('about-myself');
            let isInPortfolio = false;
            if (portfolioSection) {
                const rect = portfolioSection.getBoundingClientRect();
                if (rect.top <= scrollThreshold && rect.bottom >= scrollThreshold) {
                    isInPortfolio = true;
                    current = 'portfolio';
                }
            }
            if (aboutMyselfSection && !isInPortfolio) {
                const rect = aboutMyselfSection.getBoundingClientRect();
                if (rect.top <= scrollThreshold && rect.bottom >= scrollThreshold) {
                    current = 'portfolio';
                }
            }
            
            // Contact section + Favorite Quotes + Footer → Contact
            const contactSection = document.getElementById('contact');
            const favoriteQuotesSection = document.getElementById('quote');
            const footerSection = document.querySelector('.footer');
            let isInContact = false;
            if (contactSection) {
                const rect = contactSection.getBoundingClientRect();
                if (rect.top <= scrollThreshold && rect.bottom >= scrollThreshold) {
                    isInContact = true;
                    current = 'contact';
                }
            }
            if (favoriteQuotesSection && !isInContact) {
                const rect = favoriteQuotesSection.getBoundingClientRect();
                if (rect.top <= scrollThreshold && rect.bottom >= scrollThreshold) {
                    current = 'contact';
                }
            }
            if (footerSection && !isInContact) {
                const rect = footerSection.getBoundingClientRect();
                if (rect.top <= scrollThreshold && rect.bottom >= scrollThreshold) {
                    current = 'contact';
                }
            }
        }
        
        // Always update active class to match indicator position (desktop: ensure sync)
        // Ensure current is always set on desktop (fallback to home)
        if (isDesktop && !current) {
            current = 'home';
        }
        
        if (current) {
            navLinks.forEach(link => {
                link.classList.remove('active');
                if (link.getAttribute('href') === `#${current}`) {
                    link.classList.add('active');
                }
            });
            
            // Update desktop underline position immediately after setting active class
            // (classList operations are synchronous, so DOM is updated immediately)
            if (isDesktop) {
                updateNavIndicator();
            }
        }
    });
}

// ============================================================================
// KokonutUI Dynamic Text (Morph Mode)
// Cloned from: https://kokonutui.com/docs/texts/dynamic-text
// Component Source: https://kokonutui.com/r/dynamic-text.json
// Author: @dorianbaffier
// ============================================================================
function initKineticTextSwapper() {
    const container = document.getElementById('kineticWordWrapper');
    if (!container) return;

    const words = [
        'Junior Officer',
        'IT Support Specialist',
        'Cybersecurity Enthusiast'
    ];

    // Strip any stray whitespace text nodes between tags
    Array.from(container.childNodes).forEach(node => {
        if (node.nodeType === Node.TEXT_NODE && !node.textContent.trim()) {
            node.remove();
        }
    });

    let measureEl = container.querySelector('.dynamic-text-measure');
    let liveEl = container.querySelector('.dynamic-text-live');
    const initialEl = container.querySelector('.dynamic-text-initial');
    if (initialEl) initialEl.style.display = 'none';

    if (!measureEl) {
        measureEl = document.createElement('span');
        measureEl.className = 'dynamic-text-measure';
        measureEl.setAttribute('aria-hidden', 'true');
        container.appendChild(measureEl);
    }
    if (!liveEl) {
        liveEl = document.createElement('span');
        liveEl.className = 'dynamic-text-live';
        liveEl.setAttribute('aria-hidden', 'true');
        container.appendChild(liveEl);
    }

    const STEP = 1 / 120;
    const damping = (k, zeta) => 2 * zeta * Math.sqrt(k);
    const TRAVEL_K = 140;
    const TRAVEL_C = damping(TRAVEL_K, 0.8);
    const LIFT_K = 300;
    const LIFT_C = damping(LIFT_K, 0.9);
    const SQUASH_K = 1400;
    const SQUASH_C = damping(SQUASH_K, 0.6);
    const TILT_K = 140;
    const TILT_C = damping(TILT_K, 0.7);
    const WIDTH_K = 220;
    const WIDTH_C = damping(WIDTH_K, 1);
    const GRAVITY = 32;
    const DROP = 0.7;
    const FALL_FADE = 0.9;
    const LAND_SQUASH = -0.16;
    const ENTER_STAGGER = 0.035;
    const MAX_ENTER_SPREAD = 0.45;
    const FADE_RATE = 7;
    const INTERVAL = 2600;

    const clamp01 = (n) => Math.min(1, Math.max(0, n));
    const isBlank = (c) => c.trim() === '';

    let em = parseFloat(getComputedStyle(container).fontSize) || 28;
    let reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let nextId = 0;
    let glyphs = [];
    let order = [];
    let w = 0;
    let vw = 0;
    let tw = 0;
    let started = false;
    let raf = 0;
    let last = 0;
    let wordIndex = 0;
    let isRunning = true;

    function measureTokens(text) {
        measureEl.innerHTML = '';
        const chars = Array.from(text);
        const spans = chars.map((char) => {
            const span = document.createElement('span');
            span.textContent = char;
            measureEl.appendChild(span);
            return span;
        });
        const tokens = [];
        chars.forEach((char, i) => {
            const cell = spans[i];
            if (!cell || isBlank(char)) return;
            tokens.push({ char, x: cell.offsetLeft });
        });
        return { tokens, width: measureEl.offsetWidth };
    }

    function paint(g) {
        if (!g.el) return;
        const sy = 1 + g.sq;
        const sx = 1 - g.sq * 0.6;
        g.el.style.transform = `translate3d(${g.x.toFixed(2)}px, ${g.y.toFixed(2)}px, 0) rotate(${g.r.toFixed(2)}deg) scale(${sx.toFixed(3)}, ${sy.toFixed(3)})`;
        g.el.style.opacity = g.o.toFixed(3);
    }

    function createGlyph(t) {
        const el = document.createElement('span');
        el.className = 'dynamic-text-glyph';
        el.textContent = t.char;
        liveEl.appendChild(el);

        const g = {
            id: nextId++,
            char: t.char,
            el,
            phase: 'rest',
            leaving: false,
            delay: 0,
            x: t.x,
            vx: 0,
            tx: t.x,
            x0: t.x,
            arc: 0,
            y: 0,
            vy: 0,
            ty: 0,
            r: 0,
            vr: 0,
            tr: 0,
            sq: 0,
            vsq: 0,
            o: 1,
        };
        glyphs.push(g);
        return g;
    }

    function moveGlyph(g, t, instant) {
        g.tx = t.x;
        if (instant) {
            g.x = t.x;
            g.y = 0;
            g.vx = 0;
            g.vy = 0;
            g.phase = g.o < 1 ? 'fade' : 'rest';
            return;
        }
        if (g.phase === 'rest' && Math.abs(t.x - g.x) < 0.5) {
            g.x = t.x;
            return;
        }
        g.x0 = g.x;
        g.delay = 0;
        const distance = t.x - g.x;
        g.arc = -Math.sign(distance) * Math.min(0.22 * em, Math.abs(distance) * 0.14);
        g.phase = 'travel';
    }

    function enterGlyph(g, instant, index) {
        g.o = 0;
        if (instant) {
            g.phase = 'fade';
            return;
        }
        g.y = -DROP * em;
        g.phase = 'drop';
        g.delay = index * ENTER_STAGGER;
    }

    function leaveGlyph(g, instant) {
        g.leaving = true;
        g.delay = 0;
        if (instant) {
            g.phase = 'fade';
            return;
        }
        const side = g.x + em * 0.3 < tw / 2 ? -1 : 1;
        g.tr = side * (5 + ((g.id * 7) % 11));
        g.vx = side * 0.4 * em;
        g.vy = Math.max(g.vy, 0);
        g.phase = 'fall';
    }

    function capStagger(list, entering) {
        const spread = entering * ENTER_STAGGER;
        if (spread <= MAX_ENTER_SPREAD) return;
        for (const g of list) {
            g.delay *= MAX_ENTER_SPREAD / spread;
        }
    }

    function update(tokens, width) {
        if (!started) {
            started = true;
            order = tokens.map((t) => createGlyph(t));
            w = width;
            tw = width;
            container.style.width = `${w.toFixed(2)}px`;
            for (const g of order) paint(g);
            return;
        }

        const instant = reduceMotion;
        const letters = new Map();
        for (const g of order) {
            if (!letters.has(g.char)) letters.set(g.char, []);
            letters.get(g.char).push(g);
        }

        const next = [];
        let entering = 0;
        for (const t of tokens) {
            const list = letters.get(t.char);
            const old = list && list.length > 0 ? list.shift() : null;
            if (old) {
                moveGlyph(old, t, instant);
                next.push(old);
                continue;
            }
            const g = createGlyph(t);
            enterGlyph(g, instant, entering++);
            next.push(g);
        }
        capStagger(next, entering);

        for (const list of letters.values()) {
            for (const g of list) {
                leaveGlyph(g, instant);
            }
        }

        order = next;
        tw = width;
        kick();
    }

    function stepSquash(g, h) {
        if (g.sq === 0 && g.vsq === 0) return;
        g.vsq += (-SQUASH_K * g.sq - SQUASH_C * g.vsq) * h;
        g.sq += g.vsq * h;
        if (Math.abs(g.sq) < 0.001 && Math.abs(g.vsq) < 0.01) {
            g.sq = 0;
            g.vsq = 0;
        }
    }

    function stepTravel(g, h) {
        const span = Math.abs(g.tx - g.x0);
        const p = span < 0.5 ? 1 : clamp01(1 - Math.abs(g.tx - g.x) / span);
        g.ty = g.arc * 4 * p * (1 - p);
        g.vx += (-TRAVEL_K * (g.x - g.tx) - TRAVEL_C * g.vx) * h;
        g.x += g.vx * h;
        g.vy += (-LIFT_K * (g.y - g.ty) - LIFT_C * g.vy) * h;
        g.y += g.vy * h;
        g.o = Math.min(1, g.o + FADE_RATE * h);
    }

    function stepDrop(g, h) {
        g.vy += GRAVITY * em * h;
        g.y += g.vy * h;
        if (g.y >= 0) {
            g.y = 0;
            g.vy = 0;
            g.sq = LAND_SQUASH;
            g.phase = 'rest';
        }
        g.o = clamp01(1 + g.y / (DROP * em));
    }

    function stepFall(g, h) {
        g.vy += GRAVITY * em * h;
        g.y += g.vy * h;
        g.x += g.vx * h;
        g.vr += (-TILT_K * (g.r - g.tr) - TILT_C * g.vr) * h;
        g.r += g.vr * h;
        g.o = Math.min(g.o, clamp01(1 - g.y / (FALL_FADE * em)));
    }

    function stepFade(g, h) {
        g.o = clamp01(g.o + (g.leaving ? -FADE_RATE : FADE_RATE) * h);
    }

    function stepGlyph(g, h) {
        switch (g.phase) {
            case 'travel': stepTravel(g, h); break;
            case 'drop': stepDrop(g, h); break;
            case 'fall': stepFall(g, h); break;
            case 'fade': stepFade(g, h); break;
            default: break;
        }
        stepSquash(g, h);
    }

    function settle(g) {
        if (g.leaving) {
            return g.o > 0.002;
        }
        const arrived =
            Math.abs(g.x - g.tx) < 0.05 &&
            Math.abs(g.vx) < 0.5 &&
            Math.abs(g.y) < 0.05 &&
            Math.abs(g.vy) < 0.5;
        const done =
            (g.phase === 'travel' && arrived) ||
            (g.phase === 'fade' && g.o >= 1);
        if (done) {
            g.x = g.tx;
            g.y = 0;
            g.vx = 0;
            g.vy = 0;
            g.o = 1;
            g.phase = 'rest';
        }
        return g.phase !== 'rest' || g.sq !== 0;
    }

    function stepWidth(dt) {
        if (Math.abs(w - tw) < 0.1 && Math.abs(vw) < 0.1) {
            if (w !== tw) {
                w = tw;
                vw = 0;
                container.style.width = `${w.toFixed(2)}px`;
            }
            return false;
        }
        let t = dt;
        while (t > 1e-6) {
            const h = Math.min(STEP, t);
            vw += (-WIDTH_K * (w - tw) - WIDTH_C * vw) * h;
            w += vw * h;
            t -= h;
        }
        container.style.width = `${w.toFixed(2)}px`;
        return true;
    }

    function stepAll(dt) {
        let moving = false;
        for (const g of glyphs) {
            if (g.delay > 0) {
                g.delay -= dt;
                moving = true;
                continue;
            }
            let t = dt;
            while (t > 1e-6) {
                const h = Math.min(STEP, t);
                stepGlyph(g, h);
                t -= h;
            }
            if (settle(g)) {
                moving = true;
            }
            paint(g);
        }
        return moving;
    }

    function tick(now) {
        const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
        last = now;
        const moving = stepAll(dt);
        const resizing = stepWidth(dt);

        if (glyphs.some((g) => g.leaving && g.o <= 0.002)) {
            glyphs = glyphs.filter((g) => {
                if (g.leaving && g.o <= 0.002) {
                    if (g.el && g.el.parentNode) g.el.remove();
                    return false;
                }
                return true;
            });
        }

        raf = moving || resizing ? requestAnimationFrame(tick) : 0;
    }

    function kick() {
        if (!raf) {
            last = 0;
            raf = requestAnimationFrame(tick);
        }
    }

    function setWord(text) {
        em = parseFloat(getComputedStyle(container).fontSize) || 28;
        const { tokens, width } = measureTokens(text);
        update(tokens, width);
    }

    function nextWord() {
        if (!isRunning || document.hidden) return;
        wordIndex = (wordIndex + 1) % words.length;
        setWord(words[wordIndex]);
    }

    // Initial word set
    setWord(words[0]);

    // Rotation cycle
    setInterval(nextWord, INTERVAL);

    // Visibility and resize handling
    document.addEventListener('visibilitychange', () => {
        isRunning = !document.hidden;
    });

    const observer = new IntersectionObserver((entries) => {
        isRunning = entries.some((e) => e.isIntersecting);
    }, { threshold: 0.1 });
    observer.observe(container);

    window.addEventListener('resize', () => {
        em = parseFloat(getComputedStyle(container).fontSize) || 28;
        const { tokens, width } = measureTokens(words[wordIndex]);
        tw = width;
        tokens.forEach((t, i) => {
            const g = order[i];
            if (g) {
                g.tx = t.x;
                if (g.phase === 'rest') {
                    g.x = t.x;
                    paint(g);
                }
            }
        });
        if (!raf) {
            w = width;
            container.style.width = `${w.toFixed(2)}px`;
        }
    }, { passive: true });
}

// ============================================================================
// Prism Gradient Background (@componentry/prism-gradient)
// Source: https://componentry.dev/r/prism-gradient.json
// Author: Harsh Jadhav
// Theme-aware WebGL2 prism field with liquid checkered motion, refraction,
// and tactile grain overlay.
// ============================================================================
function initPrismGradient() {
    const container = document.getElementById('heroPrismGradient');
    const canvas = document.getElementById('heroPrismCanvas');
    if (!container || !canvas || container.dataset.prismInitialized) return;
    container.dataset.prismInitialized = 'true';

    const PRISM = {
        dark: ['#050505', '#66B3FF', '#FFFFFF'],
        light: ['#FAFAFA', '#66B3FF', '#050505'],
        rotation: -50,
        proportion: 1,
        scale: 0.01,
        speed: 30,
        distortion: 0,
        swirl: 50,
        swirlIterations: 16,
        softness: 47,
        offset: -299,
        shapeSize: 45,
    };

    function hexToRgba(hex) {
        const value = hex.replace('#', '');
        const expanded = value.length === 3
            ? value.split('').map(c => c + c).join('')
            : value;
        return [
            parseInt(expanded.slice(0, 2), 16) / 255,
            parseInt(expanded.slice(2, 4), 16) / 255,
            parseInt(expanded.slice(4, 6), 16) / 255,
            expanded.length === 8 ? parseInt(expanded.slice(6, 8), 16) / 255 : 1,
        ];
    }

    const gl = canvas.getContext('webgl2', {
        premultipliedAlpha: true,
        alpha: true,
        antialias: true,
    });

    if (!gl) {
        console.warn('WebGL2 not supported for PrismGradient, using fallback');
        const fallback = document.createElement('div');
        fallback.className = 'hero-prism-fallback';
        container.appendChild(fallback);
        return;
    }

    const VERTEX_SHADER = `#version 300 es
in vec4 a_position;
void main() {
    gl_Position = a_position;
}`;

    const FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform float u_time;
uniform float u_pixelRatio;
uniform vec2 u_resolution;
uniform float u_scale;
uniform float u_rotation;
uniform vec4 u_color1;
uniform vec4 u_color2;
uniform vec4 u_color3;
uniform float u_proportion;
uniform float u_softness;
uniform float u_shapeScale;
uniform float u_distortion;
uniform float u_swirl;
uniform float u_swirlIterations;

out vec4 fragColor;

#define TWO_PI 6.28318530718
#define PI 3.14159265358979323846

vec2 rotate(vec2 uv, float th) {
    return mat2(cos(th), sin(th), -sin(th), cos(th)) * uv;
}

float random(vec2 st) {
    return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
}

float noise(vec2 st) {
    vec2 i = floor(st);
    vec2 f = fract(st);
    float a = random(i);
    float b = random(i + vec2(1.0, 0.0));
    float c = random(i + vec2(0.0, 1.0));
    float d = random(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

vec4 blendColors(vec4 c1, vec4 c2, vec4 c3, float mixer, float edgesWidth, float edgeBlur) {
    vec3 color1 = c1.rgb * c1.a;
    vec3 color2 = c2.rgb * c2.a;
    vec3 color3 = c3.rgb * c3.a;
    float r1 = smoothstep(.0 + .35 * edgesWidth, .7 - .35 * edgesWidth + .5 * edgeBlur, mixer);
    float r2 = smoothstep(.3 + .35 * edgesWidth, 1. - .35 * edgesWidth + edgeBlur, mixer);
    vec3 blendedColor2 = mix(color1, color2, r1);
    float blendedOpacity2 = mix(c1.a, c2.a, r1);
    vec3 color = mix(blendedColor2, color3, r2);
    float opacity = mix(blendedOpacity2, c3.a, r2);
    return vec4(color, opacity);
}

void main() {
    vec2 uv = gl_FragCoord.xy / u_resolution.xy;
    float time = .5 * u_time;
    float noiseScale = .0005 + .006 * u_scale;

    uv -= .5;
    uv *= noiseScale * u_resolution;
    uv = rotate(uv, u_rotation * .5 * PI);
    uv /= u_pixelRatio;
    uv += .5;

    float n1 = noise(uv + time);
    float n2 = noise(uv * 2. - time);
    float angle = n1 * TWO_PI;
    uv.x += 4. * u_distortion * n2 * cos(angle);
    uv.y += 4. * u_distortion * n2 * sin(angle);

    float iterations = ceil(clamp(u_swirlIterations, 1., 30.));
    for (float i = 1.; i <= iterations; i++) {
        uv.x += clamp(u_swirl, 0., 2.) / i * cos(time + i * 1.5 * uv.y);
        uv.y += clamp(u_swirl, 0., 2.) / i * cos(time + i * uv.x);
    }

    float proportion = clamp(u_proportion, 0., 1.);
    vec2 checksUv = uv * (.5 + 3.5 * u_shapeScale);
    float shape = .5 + .5 * sin(checksUv.x) * cos(checksUv.y);
    float mixer = shape + .48 * sign(proportion - .5) * pow(abs(proportion - .5), .5);
    vec4 colorMix = blendColors(
        u_color1,
        u_color2,
        u_color3,
        mixer,
        1. - clamp(u_softness, 0., 1.),
        .01 + .01 * u_scale
    );
    fragColor = colorMix;
}`;

    const compileShader = (type, source) => {
        const shader = gl.createShader(type);
        if (!shader) return null;
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            console.error('Shader compile error:', gl.getShaderInfoLog(shader));
            gl.deleteShader(shader);
            return null;
        }
        return shader;
    };

    const vertexShader = compileShader(gl.VERTEX_SHADER, VERTEX_SHADER);
    const fragmentShader = compileShader(gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    if (!vertexShader || !fragmentShader) return;

    const program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        console.error('Program link error:', gl.getProgramInfoLog(program));
        return;
    }
    gl.useProgram(program);

    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
        gl.STATIC_DRAW
    );

    const positionLocation = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

    const uniform = (name) => gl.getUniformLocation(program, name);
    const uniforms = {
        time: uniform('u_time'),
        resolution: uniform('u_resolution'),
        pixelRatio: uniform('u_pixelRatio'),
        scale: uniform('u_scale'),
        rotation: uniform('u_rotation'),
        color1: uniform('u_color1'),
        color2: uniform('u_color2'),
        color3: uniform('u_color3'),
        proportion: uniform('u_proportion'),
        softness: uniform('u_softness'),
        shapeScale: uniform('u_shapeScale'),
        distortion: uniform('u_distortion'),
        swirl: uniform('u_swirl'),
        swirlIterations: uniform('u_swirlIterations'),
    };

    function resize() {
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
        const w = container.clientWidth || window.innerWidth;
        const h = container.clientHeight || window.innerHeight;
        canvas.width = Math.max(1, Math.round(w * pixelRatio));
        canvas.height = Math.max(1, Math.round(h * pixelRatio));
        gl.viewport(0, 0, canvas.width, canvas.height);
    }

    resize();
    window.addEventListener('resize', resize, { passive: true });
    if ('ResizeObserver' in window) {
        const ro = new ResizeObserver(resize);
        ro.observe(container);
    }

    let startedAt = performance.now();
    let reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let isVisible = true;
    let animationFrameId = null;

    function getThemeColors() {
        const isLight = document.documentElement.getAttribute('data-theme') === 'light';
        return isLight ? PRISM.light : PRISM.dark;
    }

    function render(time) {
        if (!isVisible) {
            animationFrameId = null;
            return;
        }

        const elapsed = (time - startedAt) / 1000;
        const prismSpeed = (PRISM.speed / 100) * 5 * 1.0;
        const activeColors = getThemeColors();
        const color1 = hexToRgba(activeColors[0]);
        const color2 = hexToRgba(activeColors[1]);
        const color3 = hexToRgba(activeColors[2]);

        gl.uniform1f(uniforms.time, elapsed * prismSpeed + PRISM.offset * 0.01);
        gl.uniform2f(uniforms.resolution, canvas.width, canvas.height);
        gl.uniform1f(uniforms.pixelRatio, Math.min(window.devicePixelRatio || 1, 2));
        gl.uniform1f(uniforms.scale, PRISM.scale);
        gl.uniform1f(uniforms.rotation, (PRISM.rotation * Math.PI) / 180);
        gl.uniform4fv(uniforms.color1, color1);
        gl.uniform4fv(uniforms.color2, color2);
        gl.uniform4fv(uniforms.color3, color3);
        gl.uniform1f(uniforms.proportion, PRISM.proportion / 100);
        gl.uniform1f(uniforms.softness, PRISM.softness / 100);
        gl.uniform1f(uniforms.shapeScale, PRISM.shapeSize / 100);
        gl.uniform1f(uniforms.distortion, PRISM.distortion / 50);
        gl.uniform1f(uniforms.swirl, PRISM.swirl / 100);
        gl.uniform1f(uniforms.swirlIterations, PRISM.swirlIterations);

        gl.drawArrays(gl.TRIANGLES, 0, 6);

        if (!reduceMotion) {
            animationFrameId = requestAnimationFrame(render);
        }
    }

    animationFrameId = requestAnimationFrame(render);

    if ('IntersectionObserver' in window) {
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                isVisible = entry.isIntersecting;
                if (isVisible && !animationFrameId && !reduceMotion) {
                    animationFrameId = requestAnimationFrame(render);
                }
            });
        }, { threshold: 0.05 });
        observer.observe(container);
    }
}

function initTypewriter() {
    initKineticTextSwapper();
}

function initScrollAnimations() {
    const observerOptions = {
        threshold: 0.3,
        rootMargin: '0px 0px -50px 0px'
    };
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('fade-in');
                if (entry.target.id === 'skills' && !skillsAnimated) {
                    animateSkills();
                    skillsAnimated = true;
                }
                if (entry.target.id === 'language-proficiency') {
                    animateLanguageProficiency();
                }
            }
        });
    }, observerOptions);
    document.querySelectorAll('section').forEach(section => {
        observer.observe(section);
    });
    document.querySelectorAll('.skill-card, .project-card, .stat-card, .achievements-card, .education-card, .timeline-item').forEach((el, index) => {
        el.style.animationDelay = `${index * 0.1}s`;
        observer.observe(el);
    });
}

function animateSkills() {
    const skillCards = document.querySelectorAll('.skill-card');
    skillCards.forEach((card, index) => {
        setTimeout(() => {
            const level = card.dataset.level;
            const progressBar = card.querySelector('.skill-progress');
            const skillLevel = card.querySelector('.skill-level');
            if (progressBar) {
                let percentage;
                // Get the specific skill name to set exact percentages
                const skillName = card.dataset.skill;
                
                switch(skillName) {
                    case 'HTML5': percentage = 97; break;
                    case 'JavaScript': percentage = 85; break;
                    case 'CSS': percentage = 88; break;
                    case 'C++': percentage = 73; break;
                    case 'Python': percentage =67; break;
                    case 'Java': percentage = 45; break;
                    default: 
                        // Fallback to level-based percentages if skill not found
                        switch(level) {
                            case 'basic': percentage = 35; break;
                            case 'intermediate': percentage = 70; break;
                            case 'advanced': percentage = 95; break;
                            default: percentage = 50;
                        }
                        break;
                }
                progressBar.style.width = `${percentage}%`;
            }
            if (skillLevel) {
                skillLevel.classList.add('animate');
            }
        }, index * 300);
    });
}

// Language Proficiency Animation (simplified - no water effects)
function animateLanguageProficiency() {
    const languageCircles = document.querySelectorAll('.language-circle');
    languageCircles.forEach((circle, index) => {
        setTimeout(() => {
            // Add animate class to trigger any remaining CSS animations
            circle.classList.add('animate');
        }, index * 500); // Stagger animations by 500ms
    });
}

function scrollToSection(sectionId) {
    const element = document.getElementById(sectionId);
    if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

document.addEventListener('DOMContentLoaded', function() {
    const cards = document.querySelectorAll('.project-card, .achievements-card, .education-card');
    cards.forEach(card => {
        card.addEventListener('mouseenter', function() {
            this.style.transform = 'scale(1.02) translateY(-5px)';
        });
        card.addEventListener('mouseleave', function() {
            this.style.transform = 'scale(1) translateY(0)';
        });
    });
    
    // Call animateSkills to start the progress bar animations
    animateSkills();
    
    // Progress Bars Animation on Scroll
    const progressFills = document.querySelectorAll('.progress-fill');
    if (progressFills.length > 0) {
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const progressFill = entry.target;
                    const percentage = progressFill.getAttribute('data-percentage');
                    progressFill.style.setProperty('--target-width', `${percentage}%`);
                    
                    // Set the CSS custom property on the progress bar container for callout positioning
                    const progressBar = progressFill.closest('.progress-bar');
                    if (progressBar) {
                        progressBar.style.setProperty('--target-width', `${percentage}%`);
                    }
                    
                    progressFill.classList.add('animate');
                }
            });
        }, { threshold: 0.5 });
        
        progressFills.forEach(progressFill => {
            observer.observe(progressFill);
        });
    }
});

window.addEventListener('scroll', () => {
    const scrolled = window.pageYOffset;
    const heroContent = document.querySelector('.hero-content');
    if (heroContent) {
        heroContent.style.transform = `translateY(${scrolled * 0.1}px)`;
    }
});

// Utility: Debounce
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Utility: Should Reduce Motion
function shouldReduceMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches || 
           window.innerWidth <= 480;
}

// Profile Image Transition (stub for compatibility)
function initScrollToTopButton() {
    const scrollToTopBtn = document.getElementById('scrollToTopBtn');
    if (!scrollToTopBtn) return;
    
    // Show/hide button based on scroll position
    window.addEventListener('scroll', () => {
        if (window.pageYOffset > 300) {
            scrollToTopBtn.classList.add('show');
        } else {
            scrollToTopBtn.classList.remove('show');
        }
    });
    
    // Smooth scroll to top when button is clicked
    scrollToTopBtn.addEventListener('click', () => {
        window.scrollTo({
            top: 0,
            behavior: 'smooth'
        });
    });
}

function initProfileImageTransition() {}

// Mobile menu functionality is handled in initNavigation() function

// Flip Card Animation Logic
(function() {
  const flipCard = document.querySelector('.flip-card');
  if (!flipCard) return;
  let isFlipped = false;
  let flipInterval;
  let hoverPaused = false;

  function flip() {
    if (!hoverPaused) {
      isFlipped = !isFlipped;
      flipCard.classList.toggle('flipping', isFlipped);
    }
  }

  function startFlipping() {
    flipInterval = setInterval(flip, 15000);
  }

  function stopFlipping() {
    clearInterval(flipInterval);
  }

  // Start flipping automatically
  startFlipping();

  // Pause on hover
  flipCard.addEventListener('mouseenter', function() {
    hoverPaused = true;
    stopFlipping();
  });
  flipCard.addEventListener('mouseleave', function() {
    hoverPaused = false;
    startFlipping();
  });

  // Ensure the card flips back to front after 10s
  setInterval(function() {
    if (!hoverPaused && isFlipped) {
      isFlipped = false;
      flipCard.classList.remove('flipping');
    }
  }, 20000);
})();

// Ensure particles.js is loaded and initialize as soon as possible
function initParticlesNetwork() {
    if (typeof window.particlesJS !== 'function') {
        console.error('particles.js is not loaded!');
        return;
    }
    particlesJS('particles-js', {
        particles: {
            number: { value: 90, density: { enable: true, value_area: 900 } },
            color: { value: '#a78bfa' },
            shape: { type: 'circle' },
            opacity: { value: 0.11, random: false },
            size: { value: 3.5, random: false },
            line_linked: {
                enable: true,
                distance: 100,
                color: '#a78bfa',
                opacity: 0.45,
                width: 2.2
            },
            move: {
                enable: true,
                speed: 0.4,
                direction: 'none',
                random: true,
                straight: false,
                out_mode: 'out',
                bounce: false
            }
        },
        interactivity: {
            detect_on: 'window',
            events: {
                onhover: { enable: true, mode: 'repulse' },
                onclick: { enable: false },
                resize: true
            },
            modes: {
                repulse: { distance: 70, duration: 1.2 }
            }
        },
        retina_detect: true
    });
}

// Try to initialize particles.js as soon as the script is loaded
if (document.getElementById('particles-js')) {
    if (typeof window.particlesJS === 'function') {
        initParticlesNetwork();
    } else {
        // Wait for the CDN to load if not yet available
        let tries = 0;
        const tryInit = setInterval(() => {
            if (typeof window.particlesJS === 'function') {
                clearInterval(tryInit);
                initParticlesNetwork();
            } else if (++tries > 20) {
                clearInterval(tryInit);
                console.error('particles.js failed to load after waiting.');
            }
        }, 200);
    }
}

// Navigation indicator functionality
// Keep a persistent reference for desktop so the capsule never disappears
let __desktopLastActiveLink = null;
let __navIndicatorLockUntil = 0; // desktop-only: lock scroll-driven updates briefly after clicks

function updateNavIndicator(targetLink) {
  try {
    const container = document.querySelector('.floating-pill-nav') || document.querySelector('#navbar .nav-container .nav-links');
    if (!container) return;

    if (window.innerWidth <= 1024) {
      const activeBg = container.querySelector('.floating-pill-active-bg');
      if (activeBg) activeBg.style.opacity = '0';
      return;
    }

    let activeLink = targetLink || container.querySelector('.nav-link.active');

    // If no active link resolved (edge thresholds during scroll), fall back to last known
    if (!activeLink) {
      if (!__desktopLastActiveLink || !document.body.contains(__desktopLastActiveLink)) {
        // Fallback to the first nav link (usually Home) to keep indicator visible
        __desktopLastActiveLink = container.querySelector('.nav-link');
      }
      activeLink = __desktopLastActiveLink;
    }

    // At this point we must have an element to point at
    if (!activeLink) return;

    // Persist last known for future gaps
    __desktopLastActiveLink = activeLink;

    const left = activeLink.offsetLeft;
    const width = activeLink.offsetWidth;
    const top = activeLink.offsetTop;
    const height = activeLink.offsetHeight;

    const activeBg = container.querySelector('.floating-pill-active-bg');
    if (activeBg) {
      activeBg.style.transform = `translateX(${left}px)`;
      activeBg.style.width = `${width}px`;
      if (height > 0) {
        activeBg.style.top = `${top}px`;
        activeBg.style.height = `${height}px`;
      }
      activeBg.style.opacity = '1';
    }

    // Hide hover indicator if active capsule moved to this link
    const hoverBg = container.querySelector('.floating-pill-hover-bg');
    if (hoverBg && hoverBg.dataset.currentLink === activeLink.getAttribute('href')) {
      hoverBg.style.opacity = '0';
    }

    // Backwards compatibility for CSS variable consumers
    container.style.setProperty('--nav-indicator-left', left + 'px');
    container.style.setProperty('--nav-indicator-width', width + 'px');
    container.style.setProperty('--nav-indicator-opacity', '1');
  } catch (e) {
    console.error('Error updating nav indicator:', e);
  }
}

// Framer Floating Pill Hover effect (slides hover capsule on mouseenter)
function initFloatingPillHover() {
  const container = document.querySelector('.floating-pill-nav');
  if (!container) return;
  const hoverBg = container.querySelector('.floating-pill-hover-bg');
  if (!hoverBg) return;
  const links = container.querySelectorAll('.nav-link');

  links.forEach(link => {
    link.addEventListener('mouseenter', () => {
      if (window.innerWidth <= 1024) return;
      if (link.classList.contains('active')) {
        hoverBg.style.opacity = '0';
        return;
      }
      const left = link.offsetLeft;
      const width = link.offsetWidth;
      const top = link.offsetTop;
      const height = link.offsetHeight;

      hoverBg.style.transform = `translateX(${left}px)`;
      hoverBg.style.width = `${width}px`;
      if (height > 0) {
        hoverBg.style.top = `${top}px`;
        hoverBg.style.height = `${height}px`;
      }
      hoverBg.dataset.currentLink = link.getAttribute('href');
      hoverBg.style.opacity = '1';
    });

    link.addEventListener('click', () => {
      hoverBg.style.opacity = '0';
    });
  });

  container.addEventListener('mouseleave', () => {
    hoverBg.style.opacity = '0';
  });
}

// Framer Text Video Mask component initialization
function initTextVideoMask() {
  const video = document.querySelector('.hero-title-mask-video');
  const fallback = document.querySelector('.hero-title-mask-fallback');
  if (!video) return;

  const onReady = () => {
    video.classList.add('is-playing');
    if (fallback) {
      fallback.style.opacity = '0';
    }
  };

  if (video.readyState >= 2) {
    onReady();
  } else {
    video.addEventListener('playing', onReady, { once: true });
    video.addEventListener('loadeddata', onReady, { once: true });
    video.addEventListener('canplay', onReady, { once: true });
  }

  // Ensure autoplay is attempted
  const playPromise = video.play();
  if (playPromise !== undefined) {
    playPromise.catch(() => {
      // Autoplay blocked by browser policy; fallback gradient text remains visible
    });
  }
}

// Keep floating navbar indicator active on scroll
window.addEventListener('scroll', function() {
  if (typeof updateNavIndicator === 'function') {
    updateNavIndicator();
  }
}, { passive: true });

// Initialize footer floating shapes remains

// ============================================================================
// KokonutUI Shape Hero: Interactive 2D Capsule Physics Background for Footer
// Cloned from: https://kokonutui.com/docs/backgrounds/shape-hero
// Component Source: https://kokonutui.com/r/shape-hero.json
// Author: @dorianbaffier
// ============================================================================
function initKokonutShapeHeroFooter() {
  const footer = document.querySelector('.footer');
  const layer = document.querySelector('.footer-shapes-layer');
  if (!footer || !layer) return;

  const STEP = 1 / 120;
  const GRAVITY = 2600;
  const ITERATIONS = 16;
  const FRICTION = 0.5;
  const RESTITUTION = 0.22;
  const BOUNCE_THRESHOLD = 140;
  const SLOP = 0.4;
  const CORRECTION = 0.3;
  const MAX_SPEED = 3200;
  const MAX_SPIN = 18;
  const SLEEP_SPEED = 9;
  const SLEEP_STEPS = 40;
  const REST_SPEED = 30;
  const DRAG_REACH = 0.28;

  const elements = Array.from(layer.querySelectorAll('[data-shape]'));
  if (elements.length === 0) return;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fill = window.innerWidth <= 768 ? 0.40 : 0.35;

  const world = {
    bodies: [],
    width: layer.clientWidth,
    height: layer.clientHeight,
    drag: null,
    still: 0,
  };

  let raf = 0;
  let last = 0;
  let carry = 0;
  let started = false;
  let visible = false;

  function ends(body) {
    if (body.half === 0) {
      return [[body.x, body.y]];
    }
    const c = Math.cos(body.a) * body.half;
    const s = Math.sin(body.a) * body.half;
    return [
      [body.x - c, body.y - s],
      [body.x + c, body.y + s],
    ];
  }

  function closest(p, seg) {
    const [a, b = a] = seg;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const length = dx * dx + dy * dy;
    const t = length === 0
      ? 0
      : Math.min(Math.max(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length, 0), 1);
    return [a[0] + dx * t, a[1] + dy * t];
  }

  function contact(a, b, nx, ny, px, py, depth) {
    return {
      a,
      b,
      nx,
      ny,
      rax: px - a.x,
      ray: py - a.y,
      rbx: b ? px - b.x : 0,
      rby: b ? py - b.y : 0,
      depth,
      correct: true,
      target: 0,
      kn: 0,
      kt: 0,
      jn: 0,
      jt: 0,
    };
  }

  function collidePair(a, b, out) {
    const reach = a.r + b.r;
    const spineA = ends(a);
    const spineB = ends(b);
    const found = [];
    const test = (p, q, fromB) => {
      const dx = fromB ? q[0] - p[0] : p[0] - q[0];
      const dy = fromB ? q[1] - p[1] : p[1] - q[1];
      const distance = Math.hypot(dx, dy);
      if (distance >= reach + 0.5) return;
      const nx = distance > 1e-6 ? dx / distance : 0;
      const ny = distance > 1e-6 ? dy / distance : -1;
      const [ax, ay] = fromB ? q : p;
      const px = ax - nx * (a.r - (reach - distance) / 2);
      const py = ay - ny * (a.r - (reach - distance) / 2);
      found.push(contact(a, b, nx, ny, px, py, reach - distance));
    };
    for (const p of spineA) {
      test(p, closest(p, spineB), false);
    }
    for (const p of spineB) {
      test(p, closest(p, spineA), true);
    }
    if (found.length === 0) {
      const p = closest([b.x, b.y], spineA);
      test(p, closest(p, spineB), false);
    }
    let deepest = null;
    for (const c of found) {
      c.correct = false;
      if (!deepest || c.depth > deepest.depth) {
        deepest = c;
      }
      out.push(c);
    }
    if (deepest) {
      deepest.correct = true;
    }
  }

  function collideWalls(body, width, height, out) {
    let deepest = null;
    const add = (c) => {
      c.correct = false;
      if (!deepest || c.depth > deepest.depth) {
        deepest = c;
      }
      out.push(c);
    };
    for (const [x, y] of ends(body)) {
      if (y + body.r - height > -0.5) {
        add(contact(body, null, 0, -1, x, height, y + body.r - height));
      }
      if (body.r - x > -0.5) {
        add(contact(body, null, 1, 0, 0, y, body.r - x));
      }
      if (x + body.r - width > -0.5) {
        add(contact(body, null, -1, 0, width, y, x + body.r - width));
      }
    }
    if (deepest) {
      deepest.correct = true;
    }
  }

  function relativeVelocity(c) {
    const { a, b } = c;
    let vx = a.vx - a.w * c.ray;
    let vy = a.vy + a.w * c.rax;
    if (b) {
      vx -= b.vx - b.w * c.rby;
      vy -= b.vy + b.w * c.rbx;
    }
    return [vx, vy];
  }

  function applyImpulse(c, jx, jy) {
    const { a, b } = c;
    a.vx += jx * a.invMass;
    a.vy += jy * a.invMass;
    a.w += a.invInertia * (c.rax * jy - c.ray * jx);
    if (b) {
      b.vx -= jx * b.invMass;
      b.vy -= jy * b.invMass;
      b.w -= b.invInertia * (c.rbx * jy - c.rby * jx);
    }
  }

  function effectiveMass(c, nx, ny) {
    const { a, b } = c;
    const ra = c.rax * ny - c.ray * nx;
    let k = a.invMass + a.invInertia * ra * ra;
    if (b) {
      const rb = c.rbx * ny - c.rby * nx;
      k += b.invMass + b.invInertia * rb * rb;
    }
    return k;
  }

  function prepare(c) {
    c.kn = effectiveMass(c, c.nx, c.ny);
    c.kt = effectiveMass(c, -c.ny, c.nx);
    const [vx, vy] = relativeVelocity(c);
    const vn = vx * c.nx + vy * c.ny;
    if (c.depth < 0) {
      c.target = c.depth / STEP;
    } else {
      c.target = vn < -BOUNCE_THRESHOLD ? -RESTITUTION * vn : 0;
    }
  }

  function solve(c) {
    let [vx, vy] = relativeVelocity(c);
    const vn = vx * c.nx + vy * c.ny;
    const jn = Math.max(c.jn + (c.target - vn) / c.kn, 0);
    const dn = jn - c.jn;
    c.jn = jn;
    applyImpulse(c, c.nx * dn, c.ny * dn);

    [vx, vy] = relativeVelocity(c);
    const tx = -c.ny;
    const ty = c.nx;
    const limit = FRICTION * c.jn;
    const jt = Math.min(
      Math.max(c.jt - (vx * tx + vy * ty) / c.kt, -limit),
      limit
    );
    const dt = jt - c.jt;
    c.jt = jt;
    applyImpulse(c, tx * dt, ty * dt);
  }

  function correct(c) {
    if (!c.correct || c.depth <= SLOP) return;
    const { a, b } = c;
    const total = a.invMass + (b ? b.invMass : 0);
    const push = ((c.depth - SLOP) * CORRECTION) / total;
    a.x += c.nx * push * a.invMass;
    a.y += c.ny * push * a.invMass;
    if (b) {
      b.x -= c.nx * push * b.invMass;
      b.y -= c.ny * push * b.invMass;
    }
  }

  function applyDrag(drag) {
    const { body } = drag;
    const cos = Math.cos(body.a);
    const sin = Math.sin(body.a);
    const rx = drag.lx * cos - drag.ly * sin;
    const ry = drag.lx * sin + drag.ly * cos;
    const handle = contact(body, null, 0, 0, body.x + rx, body.y + ry, 0);
    const [vx] = relativeVelocity(handle);
    const wantX = ((drag.tx - body.x - rx) / STEP) * DRAG_REACH;
    const wantY = ((drag.ty - body.y - ry) / STEP) * DRAG_REACH;
    applyImpulse(handle, (wantX - vx) / effectiveMass(handle, 1, 0), 0);
    const [, vy] = relativeVelocity(handle);
    applyImpulse(handle, 0, (wantY - vy) / effectiveMass(handle, 0, 1));
    body.w *= 0.96;
  }

  function clampSpeed(body) {
    const speed = Math.hypot(body.vx, body.vy);
    if (speed > MAX_SPEED) {
      body.vx *= MAX_SPEED / speed;
      body.vy *= MAX_SPEED / speed;
    }
    body.w = Math.min(Math.max(body.w, -MAX_SPIN), MAX_SPIN);
  }

  function step(w) {
    const { bodies, width, height, drag } = w;
    for (const body of bodies) {
      body.vy += GRAVITY * STEP;
      body.vx *= 0.999;
      body.w *= 0.995;
    }
    if (drag) {
      applyDrag(drag);
    }
    const contacts = [];
    for (let i = 0; i < bodies.length; i++) {
      collideWalls(bodies[i], width, height, contacts);
      for (let j = i + 1; j < bodies.length; j++) {
        const a = bodies[i];
        const b = bodies[j];
        const near = a.half + a.r + b.half + b.r;
        if (Math.abs(a.x - b.x) < near && Math.abs(a.y - b.y) < near) {
          collidePair(a, b, contacts);
        }
      }
    }
    for (const c of contacts) {
      prepare(c);
    }
    for (let k = 0; k < ITERATIONS; k++) {
      for (const c of contacts) {
        solve(c);
      }
    }
    let fastest = 0;
    for (const body of bodies) {
      clampSpeed(body);
      if (
        body !== drag?.body &&
        Math.hypot(body.vx, body.vy) + Math.abs(body.w) * body.r < REST_SPEED
      ) {
        body.vx *= 0.8;
        body.vy *= 0.8;
        body.w *= 0.8;
      }
      body.x += body.vx * STEP;
      body.y += body.vy * STEP;
      body.a += body.w * STEP;
      fastest = Math.max(
        fastest,
        Math.hypot(body.vx, body.vy) + Math.abs(body.w) * (body.half + body.r)
      );
    }
    for (const c of contacts) {
      correct(c);
    }
    w.still = fastest < SLEEP_SPEED && !drag ? w.still + 1 : 0;
    return w.still > SLEEP_STEPS;
  }

  function render(bodies) {
    for (const body of bodies) {
      body.el.style.transform = `translate3d(${(body.x - body.width / 2).toFixed(2)}px, ${(body.y - body.height / 2).toFixed(2)}px, 0) rotate(${body.a.toFixed(4)}rad)`;
    }
  }

  const scatter = (n) => (Math.sin(n * 12.9898) * 43758.5453) % 1;

  function createBodies(els, width, height, fillRatio) {
    const bodies = [];
    let area = 0;
    for (const [index, el] of els.entries()) {
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      if (area + w * h > width * height * fillRatio) {
        el.style.visibility = 'hidden';
        continue;
      }
      area += w * h;
      const r = Math.min(w, h) / 2;
      const mass = (w * h) / 1000;
      const normIndex = (index + 0.5) / els.length;
      const jitter = (scatter(index + 1) - 0.5) * 0.18;
      const xPct = Math.min(Math.max(normIndex + jitter, 0.05), 0.95);
      bodies.push({
        x: width * xPct,
        y: -h - index * 48,
        a: (scatter(index + 7) - 0.5) * 1.2,
        vx: (scatter(index + 3) - 0.5) * 180,
        vy: 0,
        w: (scatter(index + 5) - 0.5) * 2.5,
        half: Math.max(w - h, 0) / 2,
        r,
        invMass: 1 / mass,
        invInertia: 12 / (mass * (w * w + h * h)),
        width: w,
        height: h,
        el,
      });
      el.style.visibility = 'visible';
    }
    return bodies;
  }

  function hitTest(bodies, x, y) {
    for (let i = bodies.length - 1; i >= 0; i--) {
      const body = bodies[i];
      const [qx, qy] = closest([x, y], ends(body));
      if (Math.hypot(x - qx, y - qy) <= body.r) {
        return body;
      }
    }
    return null;
  }

  const loop = (now) => {
    raf = 0;
    carry += Math.min((now - last) / 1000, 0.05);
    last = now;
    let asleep = false;
    while (carry >= STEP) {
      asleep = step(world);
      carry -= STEP;
    }
    render(world.bodies);
    if (!asleep && visible) {
      raf = requestAnimationFrame(loop);
    }
  };

  const wake = () => {
    world.still = 0;
    if (!raf && started && visible) {
      last = performance.now();
      raf = requestAnimationFrame(loop);
    }
  };

  const begin = () => {
    if (started) return;
    world.width = layer.clientWidth;
    world.height = layer.clientHeight;
    if (world.width === 0 || world.height === 0) return;
    started = true;
    world.bodies = createBodies(elements, world.width, world.height, fill);
    if (reduceMotion) {
      let steps = 0;
      while (steps < 2400 && !step(world)) {
        steps++;
      }
      render(world.bodies);
      return;
    }
    render(world.bodies);
    wake();
  };

  const intersection = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting && !document.hidden;
    if (visible) {
      if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(begin);
      } else {
        begin();
      }
      wake();
    }
  }, { threshold: 0.05 });
  intersection.observe(footer);

  document.addEventListener('visibilitychange', () => {
    visible = !document.hidden;
    wake();
  });

  const resizeObserver = new ResizeObserver(() => {
    if (layer.clientWidth > 0 && layer.clientHeight > 0) {
      world.width = layer.clientWidth;
      world.height = layer.clientHeight;
      wake();
    }
  });
  resizeObserver.observe(layer);

  const local = (event) => {
    const rect = layer.getBoundingClientRect();
    return [event.clientX - rect.left, event.clientY - rect.top];
  };

  const onDown = (event) => {
    if (!started || world.drag || event.button !== 0) return;
    const [x, y] = local(event);
    const body = hitTest(world.bodies, x, y);
    if (!body) return;
    event.preventDefault();
    const dx = x - body.x;
    const dy = y - body.y;
    const cos = Math.cos(-body.a);
    const sin = Math.sin(-body.a);
    world.drag = {
      body,
      lx: dx * cos - dy * sin,
      ly: dx * sin + dy * cos,
      tx: x,
      ty: y,
      id: event.pointerId,
    };
    layer.setPointerCapture(event.pointerId);
    layer.setAttribute('data-dragging', '');
    wake();
  };

  const onMove = (event) => {
    if (world.drag && world.drag.id === event.pointerId) {
      [world.drag.tx, world.drag.ty] = local(event);
      wake();
    }
  };

  const onUp = (event) => {
    if (world.drag && world.drag.id === event.pointerId) {
      world.drag = null;
      layer.removeAttribute('data-dragging');
      wake();
    }
  };

  layer.addEventListener('pointerdown', onDown);
  layer.addEventListener('pointermove', onMove);
  layer.addEventListener('pointerup', onUp);
  layer.addEventListener('pointercancel', onUp);
}



// Download icon click handler
document.addEventListener('DOMContentLoaded', function() {
  const downloadIcon = document.querySelector('.contact-section .contact-item:nth-child(4) .contact-icon');
  
  if (downloadIcon) {
    downloadIcon.addEventListener('click', function() {
      const iconElement = this.querySelector('i');
      if (iconElement) {
        this.classList.add('clicked');
        
        // Remove the clicked class after animation completes
        setTimeout(() => {
          this.classList.remove('clicked');
        }, 800);
      }
    });
  }
});

// Statistics counting animation
function animateCount(element, target, duration = 2000, originalTargetText) {
    const startTime = performance.now();
    const hasPlus = originalTargetText.includes('+');
    const targetStr = originalTargetText.replace('+', '');
    const decimalIndex = targetStr.indexOf('.');
    const decimalPlaces = decimalIndex >= 0 ? (targetStr.length - decimalIndex - 1) : 0;

    function updateCount(currentTime) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);

        // Smooth easing without overshoot; clamp to target
        const easeOutCubic = 1 - Math.pow(1 - progress, 3);
        let currentValue = target * easeOutCubic;
        currentValue = Math.min(currentValue, target);

        if (progress < 1) {
            if (decimalPlaces > 0) {
                element.textContent = Number(currentValue).toFixed(decimalPlaces) + (hasPlus ? '+' : '');
            } else {
                element.textContent = Math.floor(currentValue) + (hasPlus ? '+' : '');
            }
            requestAnimationFrame(updateCount);
        } else {
            element.textContent = originalTargetText;
        }
    }

    requestAnimationFrame(updateCount);
}

// Intersection Observer for statistics animation
function initStatsAnimation() {
    const statsSection = document.querySelector('.stats-grid');
    if (!statsSection) return;
    
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const statNumbers = entry.target.querySelectorAll('.stat-card h3');
                
                statNumbers.forEach((numberElement, index) => {
                    const targetValue = numberElement.textContent;
                    let numericValue;
                    
                    // Parse the target value
                    if (targetValue.includes('+')) {
                        numericValue = parseFloat(targetValue.replace('+', ''));
                    } else {
                        numericValue = parseInt(targetValue);
                    }
                    
                    // Store the original target value for the animation
                    const originalTargetText = targetValue;
                    
                    // Start with 0 for the animation
                    if (targetValue.includes('+')) {
                        numberElement.textContent = '0+';
                    } else {
                        numberElement.textContent = '0';
                    }
                    
                    // Animate after a small delay for staggered effect
                    setTimeout(() => {
                        animateCount(numberElement, numericValue, 3000, originalTargetText);
                    }, index * 100);
                });
                
                // Unobserve after animation to prevent re-triggering
                observer.unobserve(entry.target);
            }
        });
    }, { threshold: 0.5 });
    
    observer.observe(statsSection);
}

// Mobile-only: Calculate and display dynamic experience based on job start date (June 16, 2025)
function updateExperienceDisplay() {
    // Only apply to mobile version (max-width: 1024px)
    if (window.innerWidth > 1024) {
        return;
    }
    
    const experienceValue = document.getElementById('experience-value');
    const experienceLabel = document.getElementById('experience-label');
    
    if (!experienceValue || !experienceLabel) {
        return;
    }
    
    // Job start date: June 16, 2025
    const jobStartDate = new Date(2025, 5, 16); // Month is 0-indexed, so 5 = June
    
    // Get current date
    const currentDate = new Date();
    
    // Calculate difference in months
    let months = (currentDate.getFullYear() - jobStartDate.getFullYear()) * 12;
    months += currentDate.getMonth() - jobStartDate.getMonth();
    
    // Adjust for day of month (if current day is before start day, subtract a month)
    if (currentDate.getDate() < jobStartDate.getDate()) {
        months--;
    }
    
    // Calculate years (complete years only)
    const years = Math.floor(months / 12);
    const remainingMonths = months % 12;
    
    // Determine display format
    let displayValue, displayLabel;
    
    if (years >= 1) {
        // Display as "1+ year" or "2+ years" etc.
        displayValue = years + '+';
        displayLabel = years === 1 ? 'Year Of Experience' : 'Years Of Experience';
    } else {
        // Display as "0+ months"
        displayValue = Math.max(months, 0) + '+';
        displayLabel = 'Months Experience';
    }
    
    // Update the DOM
    experienceValue.textContent = displayValue;
    experienceLabel.textContent = displayLabel;
}

// Schedule experience update check for the 16th day of each month
function scheduleExperienceUpdate() {
    // Only apply to mobile version
    if (window.innerWidth > 1024) {
        return;
    }
    
    function checkAndUpdateExperience() {
        const today = new Date();
        
        // Check if today is the 16th day of the month
        if (today.getDate() === 16) {
            updateExperienceDisplay();
        }
    }
    
    // Run the check immediately on page load
    updateExperienceDisplay();
    
    // Set up daily check at midnight to see if it's the 16th
    setInterval(checkAndUpdateExperience, 24 * 60 * 60 * 1000); // Check once per day
}

// Initialize statistics animation when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
    // Update experience display on page load and schedule future updates
    scheduleExperienceUpdate();
    initStatsAnimation();
    initProgressBars();
    initCircularProgress();
});

// Technical Skills progress bar animation
function initProgressBars() {
    const progressBars = document.querySelectorAll('.progress-fill[data-percentage]');
    
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const progressFill = entry.target;
                const percentage = progressFill.getAttribute('data-percentage');
                
                // Animate the progress bar from 0 to target percentage
                animateProgressBar(progressFill, percentage);
                
                // Unobserve after animation to prevent re-triggering
                observer.unobserve(entry.target);
            }
        });
    }, { threshold: 0.5 });
    
    progressBars.forEach(bar => observer.observe(bar));
}

function animateProgressBar(progressFill, targetPercentage) {
    const duration = 2000; // 2 seconds
    const startTime = performance.now();
    
    function updateProgress(currentTime) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        
        // Smooth easing function
        const easeOutCubic = 1 - Math.pow(1 - progress, 3);
        const currentPercentage = targetPercentage * easeOutCubic;
        
        if (progress < 1) {
            // Update the progress bar width
            progressFill.style.width = currentPercentage + '%';
            requestAnimationFrame(updateProgress);
        } else {
            // Set final value
            progressFill.style.width = targetPercentage + '%';
            
            // Add animate class to trigger CSS transitions
            progressFill.classList.add('animate');
            
            // Show callout immediately when progress bar stops with bouncy effect
            const callout = progressFill.nextElementSibling;
            if (callout && callout.classList.contains('progress-callout')) {
                // Add bouncy transition for callout appearance
                callout.style.transition = 'all 0.8s cubic-bezier(0.68, -0.55, 0.265, 1.55)';
                callout.style.opacity = '1';
                
                // Handle different callout positioning based on skill level with bouncy effect
                if (callout.classList.contains('skill-intermediate')) {
                    callout.style.transform = 'translateX(-50%) translateY(0) scale(1.1)';
                    // Add bounce back effect
                    setTimeout(() => {
                        callout.style.transition = 'all 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
                        callout.style.transform = 'translateX(-50%) translateY(0) scale(1)';
                    }, 200);
                } else if (callout.classList.contains('skill-basic')) {
                    callout.style.transform = 'translateX(-50%) translateY(0) scale(1.1)';
                    // Add bounce back effect
                    setTimeout(() => {
                        callout.style.transition = 'all 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
                        callout.style.transform = 'translateX(-50%) translateY(0) scale(1)';
                    }, 200);
                } else {
                    callout.style.transform = 'translateY(0) scale(1.1)';
                    // Add bounce back effect
                    setTimeout(() => {
                        callout.style.transition = 'all 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
                        callout.style.transform = 'translateY(0) scale(1)';
                    }, 200);
                }
            }
        }
    }
    
    requestAnimationFrame(updateProgress);
}

// Circular progress bar animation
function initCircularProgress() {
    const circularProgressBars = document.querySelectorAll('.circular-progress');
    
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const progressBar = entry.target;
                const percentage = progressBar.getAttribute('data-percentage');
                const progressFill = progressBar.querySelector('.progress-fill');
                
                // Animate the circular progress from 0 to target percentage
                animateCircularProgress(progressFill, percentage);
                
                // Unobserve after animation to prevent re-triggering
                observer.unobserve(entry.target);
            }
        });
    }, { threshold: 0.5 });
    
    circularProgressBars.forEach(bar => observer.observe(bar));
}

function animateCircularProgress(progressFill, targetPercentage) {
    const duration = 2000; // 2 seconds
    const startTime = performance.now();
    const circumference = 283; // 2 * π * radius (45)
    
    function updateProgress(currentTime) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        
        // Smooth easing function
        const easeOutCubic = 1 - Math.pow(1 - progress, 3);
        const currentPercentage = targetPercentage * easeOutCubic;
        
        if (progress < 1) {
            // Update the SVG stroke-dashoffset to show progress
            const offset = circumference - (currentPercentage / 100) * circumference;
            progressFill.style.strokeDashoffset = offset;
            requestAnimationFrame(updateProgress);
        } else {
            // Set final value
            const offset = circumference - (targetPercentage / 100) * circumference;
            progressFill.style.strokeDashoffset = offset;
        }
    }
    
    requestAnimationFrame(updateProgress);
}

// Certificate Navigation Functions
let currentScrollPosition = 0;
let isManualControl = false;
let autoScrollInterval;
let isTransitioning = false;
let originalCardsCount = 10; // Number of original cards (before duplication)
let activeIndex = 0; // Mobile-only index-based navigation
let isMobileMode = false; // Track whether we're in mobile or desktop mode

function updateActiveCertificationCard() {
    const track = document.querySelector('.certifications-track');
    const cards = track.querySelectorAll('.certification-card');
    
    if (!cards.length) return;
    
    // Remove active class from all cards
    cards.forEach(card => card.classList.remove('active'));
    
    // For mobile: use activeIndex directly
    if (isMobileMode) {
        if (cards[activeIndex]) {
            cards[activeIndex].classList.add('active');
        }
    } else {
        // For desktop: calculate which card is centered based on scroll position
        const cardWidth = cards[0].offsetWidth + 16; // card width + gap
        const centeredCardIndex = Math.round(currentScrollPosition / cardWidth) % cards.length;
        
        // Add active class to the centered card
        if (cards[centeredCardIndex]) {
            cards[centeredCardIndex].classList.add('active');
        }
    }
}

function scrollCertifications(direction) {
    const track = document.querySelector('.certifications-track');
    const carousel = document.querySelector('.certifications-carousel');
    
    if (!track || !carousel || isTransitioning) return;
    
    isTransitioning = true;
    
    // Mobile: index-based navigation with smooth animation
    if (window.innerWidth <= 1024) {
        isMobileMode = true;
        const cards = track.querySelectorAll('.certification-card');
        const totalCards = cards.length;
        
        // Update activeIndex based on direction
        if (direction === 'next') {
            activeIndex = (activeIndex + 1) % totalCards; // Wrap around at the end
        } else if (direction === 'prev') {
            activeIndex = (activeIndex - 1 + totalCards) % totalCards; // Wrap around at the start
        }
        
        // Apply smooth transform animation
        track.style.transition = 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
        track.style.transform = `translateX(${-activeIndex * 100}%)`;
        track.style.animation = 'none'; // Disable auto-scroll animation
        
        // Remove direction classes from all cards
        cards.forEach(card => {
            card.classList.remove('slide-left', 'slide-right');
        });
        
        // Add direction-specific class to new active card
        if (direction === 'next') {
            cards[activeIndex].classList.add('slide-right');
        } else if (direction === 'prev') {
            cards[activeIndex].classList.add('slide-left');
        }
        
        updateActiveCertificationCard();
        
        setTimeout(() => {
            isTransitioning = false;
        }, 300);
        
    } else {
        // Desktop: pixel-based scrolling (original behavior)
        isMobileMode = false;
        
        track.style.animation = 'none';
        isManualControl = true;
        
        const cardWidth = track.querySelector('.certification-card').offsetWidth + 16; // card width + gap
        const visibleCards = Math.floor(carousel.offsetWidth / cardWidth);
        const scrollAmount = cardWidth * Math.max(1, Math.floor(visibleCards / 2));
        
        if (direction === 'prev') {
            currentScrollPosition -= scrollAmount;
        } else if (direction === 'next') {
            currentScrollPosition += scrollAmount;
        }
        
        // Apply the new position with fast, responsive transition
        track.style.transition = 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
        track.style.transform = `translateX(-${currentScrollPosition}px)`;
        
        // Update active card class after transition
        setTimeout(() => {
            updateActiveCertificationCard();
            
            const totalCardsWidth = originalCardsCount * cardWidth;
            
            if (direction === 'next' && currentScrollPosition >= totalCardsWidth) {
                // Reset to beginning seamlessly
                track.style.transition = 'none';
                currentScrollPosition = currentScrollPosition - totalCardsWidth;
                track.style.transform = `translateX(-${currentScrollPosition}px)`;
                updateActiveCertificationCard();
            } else if (direction === 'prev' && currentScrollPosition < 0) {
                // Simplified left navigation - instant positioning
                track.style.transition = 'none';
                currentScrollPosition = totalCardsWidth + currentScrollPosition;
                track.style.transform = `translateX(-${currentScrollPosition}px)`;
                updateActiveCertificationCard();
            }
            
            isTransitioning = false;
        }, 300); // Reduced timeout for instant response
        
        // Clear any existing auto-scroll
        clearInterval(autoScrollInterval);
        clearTimeout(window.certTimeout);
        
        // Resume automatic scrolling after 3 seconds
        window.certTimeout = setTimeout(() => {
            if (isManualControl) {
                startAutoScroll();
                isManualControl = false;
            }
        }, 3000);
    }
}

function startAutoScroll() {
    const track = document.querySelector('.certifications-track');
    if (!track) return;
    
    // Clear any existing interval
    clearInterval(autoScrollInterval);
    
    // Reset position and restore the original CSS animation
    track.style.transform = 'translateX(0)';
    track.style.transition = 'none';
    track.style.animation = 'slideLeft 25s linear infinite';
    track.style.animationPlayState = 'running';
    currentScrollPosition = 0;
    activeIndex = 0; // Reset mobile index
    isMobileMode = false;
    
    // Initialize active card on first load
    updateActiveCertificationCard();
}

// Initialize auto-scroll when page loads
document.addEventListener('DOMContentLoaded', function() {
    setTimeout(() => {
        startAutoScroll();
    }, 1000); // Start after 1 second
});

// Portfolio Tab Functionality
function initPortfolioTabs() {
    const tabs = document.querySelectorAll('.portfolio-tab');
    const tabContents = document.querySelectorAll('.tab-content');
    const portfolioContent = document.querySelector('.portfolio-content');
    
    // Hide all content except the selected one
    function showTabContent(selectedTab) {
        portfolioContent.classList.remove('show-all');
        tabContents.forEach(content => {
            content.style.display = 'none';
            content.classList.remove('active');
        });
        
        const targetContent = document.getElementById(selectedTab + '-content');
        if (targetContent) {
            targetContent.style.display = 'block';
            targetContent.classList.add('active');
        }
    }
    
    // Add click event listeners to tabs
    tabs.forEach(tab => {
        tab.addEventListener('click', function() {
            // Remove active class from all tabs
            tabs.forEach(t => t.classList.remove('active'));
            
            // Add active class to clicked tab
            this.classList.add('active');
            
            // Get the tab data attribute
            const tabType = this.getAttribute('data-tab');
            
            // Show appropriate content
            showTabContent(tabType);
        });
    });
    
    // Initialize with "Certification" tab active
    showTabContent('certifications');
}

// Initialize portfolio tabs when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
    initPortfolioTabs();
    initProfileImageFlip();
});

// Accordion functionality
document.addEventListener('DOMContentLoaded', function() {
    const accordionItems = document.querySelectorAll('.accordion-item');
    
    accordionItems.forEach(item => {
        const header = item.querySelector('.accordion-header');
        
        header.addEventListener('click', function() {
            const isActive = item.classList.contains('active');
            
            // Close all accordion items
            accordionItems.forEach(otherItem => {
                otherItem.classList.remove('active');
            });
            
            // Open clicked item if it wasn't active
            if (!isActive) {
                item.classList.add('active');
            }
        });
    });
    
});

// Profile Image Switch with Flip Animation
function initProfileImageFlip() {
    const profileImage = document.getElementById('profileImage');
    const aboutSection = document.getElementById('about');
    
    if (!profileImage || !aboutSection) {
        console.log('Profile image elements not found');
        return;
    }
    
    console.log('Profile image switch initialized');
    
    const formalImageSrc = 'assets/img/profile images/robin_hossain_formal_image.jpg';
    const informalImageSrc = 'assets/img/profile images/robin_hossain_informal_image.jpg';
    
    // Function to start the image switch timer
    function startImageTimer() {
        console.log('Starting image switch timer');
        
        // Clear any existing timer
        if (profileFlipTimer) {
            clearTimeout(profileFlipTimer);
        }
        
        // Reset to formal image
        profileImage.src = formalImageSrc;
        profileImage.alt = 'Robin Hossain - Formal';
        console.log('Reset to formal image');
        
        // Determine delay based on screen width (desktop: 10s, mobile: 7s)
        const isDesktop = window.innerWidth > 1024;
        const delayMs = isDesktop ? 10000 : 7000;
        
        // After specified time, switch to informal image with flip effect
        profileFlipTimer = setTimeout(() => {
            // Add flip animation class
            profileImage.classList.add('flipping');
            console.log('Starting flip to informal image');
            
            // Switch image at the peak of the flip (halfway through animation)
            setTimeout(() => {
                profileImage.src = informalImageSrc;
                profileImage.alt = 'Robin Hossain - Informal';
                console.log('Switched to informal image');
            }, 300); // Half of 0.6s animation
            
            // Remove animation class after animation completes
            setTimeout(() => {
                profileImage.classList.remove('flipping');
            }, 600); // Full animation duration
            
            // After another specified time, switch back to formal image with flip effect
            profileFlipTimer = setTimeout(() => {
                // Add flip animation class
                profileImage.classList.add('flipping');
                console.log('Starting flip to formal image');
                
                // Switch image at the peak of the flip
                setTimeout(() => {
                    profileImage.src = formalImageSrc;
                    profileImage.alt = 'Robin Hossain - Formal';
                    console.log('Switched back to formal image');
                }, 300); // Half of 0.6s animation
                
                // Remove animation class after animation completes
                setTimeout(() => {
                    profileImage.classList.remove('flipping');
                    
                    // Restart the cycle if still in about section
                    if (isInAboutSection) {
                        startImageTimer();
                    }
                }, 600); // Full animation duration
            }, delayMs); // Use dynamic delay based on screen width
        }, delayMs); // Use dynamic delay based on screen width
    }
    
    // Function to stop the image timer
    function stopImageTimer() {
        console.log('Stopping image switch timer');
        if (profileFlipTimer) {
            clearTimeout(profileFlipTimer);
            profileFlipTimer = null;
        }
        // Reset to formal image when leaving section
        profileImage.src = formalImageSrc;
        profileImage.alt = 'Robin Hossain - Formal';
        profileImage.classList.remove('flipping');
        profileImage.style.transform = 'rotateY(0deg)';
    }
    
    // Intersection Observer to detect when user enters/leaves the about section
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                // User entered the about section
                console.log('User entered about section');
                isInAboutSection = true;
                aboutSectionStartTime = Date.now();
                startImageTimer();
            } else {
                // User left the about section
                console.log('User left about section');
                isInAboutSection = false;
                aboutSectionStartTime = null;
                stopImageTimer();
            }
        });
    }, {
        threshold: 0.3 // Trigger when 30% of the section is visible
    });
    
    // Start observing the about section
    observer.observe(aboutSection);
    console.log('Intersection observer started for about section');
    
    // Add manual test function for debugging
    window.testImageSwitch = function() {
        console.log('Manual image switch test triggered');
        if (profileImage.src.includes('formal')) {
            profileImage.src = informalImageSrc;
            profileImage.alt = 'Robin Hossain - Informal';
            console.log('Switched to informal image');
        } else {
            profileImage.src = formalImageSrc;
            profileImage.alt = 'Robin Hossain - Formal';
            console.log('Switched to formal image');
        }
    };
}

// Mobile Toast Message
// NOTE: Mobile-only behavior. Show exactly 2 seconds after full page load,
// and keep visible for 5 seconds (the 5s countdown starts only after load).
window.addEventListener('load', function() {
    // Only show on mobile (max-width: 1024px)
    if (window.innerWidth > 1024) return;

    // Create toast message (re-using existing id/class patterns)
    const toast = document.createElement('div');
    toast.id = 'mobile-toast';
    toast.textContent = 'For the best experience, please view this portfolio on a desktop.';

    // Add CSS styles (scoped to mobile-toast element)
    const style = document.createElement('style');
    style.textContent = `
        #mobile-toast {
            position: fixed !important;
            bottom: 15px !important;
            left: 50% !important;
            transform: translateX(-50%) translateY(100%) !important;
            background: rgba(17, 24, 39, 0.95) !important;
            color: #ffffff !important;
            padding: 6px 160px !important;
            border-radius: 8px !important;
            font-size: 10.5px !important;
            font-weight: 500 !important;
            z-index: 10000 !important;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3) !important;
            backdrop-filter: blur(10px) !important;
            border: 1px solid rgba(139, 92, 246, 0.3) !important;
            max-width: 90% !important;
            text-align: center !important;
            white-space: nowrap !important;
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
            opacity: 0 !important;
            transition: all 0.3s ease-out !important;
        }

        #mobile-toast.show {
            transform: translateX(-50%) translateY(0) !important;
            opacity: 1 !important;
        }

        #mobile-toast.hide {
            transform: translateX(-50%) translateY(100%) !important;
            opacity: 0 !important;
        }
    `;
    document.head.appendChild(style);

    // Wait exactly 10 seconds after the page `load` event, then show the toast.
    setTimeout(function() {
        document.body.appendChild(toast);

        // Trigger show animation (tiny delay to allow insertion)
        setTimeout(function() {
            toast.classList.add('show');
        }, 10);

        // Auto-hide after ~5 seconds (count begins after the toast is shown)
        setTimeout(function() {
            toast.classList.remove('show');
            toast.classList.add('hide');
            setTimeout(function() {
                if (toast.parentNode) {
                    toast.parentNode.removeChild(toast);
                }
            }, 300);
        }, 5000);
    }, 7000);

    // Hide on click
    toast.addEventListener('click', function() {
        toast.classList.remove('show');
        toast.classList.add('hide');
        setTimeout(function() {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
        }, 300);
    });
});

// Photography Section - Image Zoom Handler
(function() {
    function initPhotoZoom() {
        const zoomButtons = document.querySelectorAll('#photography-content .photo-zoom-btn');
        
        zoomButtons.forEach(button => {
            button.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                
                const img = this.closest('.collage-photo').querySelector('img');
                const collageItem = this.closest('.collage-item');
                if (img && collageItem) {
                    const location = collageItem.getAttribute('data-location');
                    const date = collageItem.getAttribute('data-date');
                    const isItem11 = collageItem.classList.contains('collage-item-11');
                    openImageZoom(img.src, img.alt, location, date, isItem11);
                }
            });
        });
    }
    
    function openImageZoom(imageSrc, imageAlt, location, date, isItem11 = false) {
        // Close any existing modals first
        const existingModal = document.querySelector('.photo-zoom-modal');
        if (existingModal) {
            existingModal.remove();
        }
        
        // Create modal overlay
        const modal = document.createElement('div');
        modal.className = 'photo-zoom-modal';
        
        // Build the photo-zoom-meta HTML
        let metaHTML = `
                    <div class="photo-meta-item">
                        <i class="fas fa-map-marker-alt"></i>
                        <span class="photo-meta-text">${location || 'Not specified'}</span>
                    </div>
                    <div class="photo-meta-item">
                        <i class="fas fa-calendar"></i>
                        <span class="photo-meta-text">${date || 'Not specified'}</span>
                    </div>`;
        
        let buttonHTML = '';
        if (isItem11) {
            buttonHTML = `<div class="photo-zoom-button-container">
                        <a href="https://www.dhakatribune.com/sport/other-sports/395877/bangladesh-s-chapal-elected-world-archery-asia-s." target="_blank" class="btn-primary research-btn" style="font-size: 0.9rem; padding: 0.5rem 1rem;">
                            <i class="fas fa-external-link-alt"></i>
                            View News
                        </a>
                    </div>`;
        }
        
        modal.innerHTML = `
            <div class="photo-zoom-container">
                <button class="photo-zoom-close" aria-label="Close image" type="button">
                    <i class="fas fa-times"></i>
                </button>
                <img src="${imageSrc}" alt="${imageAlt}" class="photo-zoom-image">
                <div class="photo-zoom-caption">${imageAlt}</div>
                <div class="photo-zoom-meta">
                    ${metaHTML}
                </div>
                ${buttonHTML}
            </div>
        `;
        
        document.body.appendChild(modal);
        
        // Trigger animation
        setTimeout(() => {
            modal.classList.add('active');
        }, 10);
        
        // Define close function - prevents multiple executions
        let isClosing = false;
        const closeModal = () => {
            if (isClosing) return;
            isClosing = true;
            
            modal.classList.remove('active');
            setTimeout(() => {
                if (modal.parentNode) {
                    modal.remove();
                }
                document.removeEventListener('keydown', handleEscape);
            }, 300);
        };
        
        // Close button handler
        const closeBtn = modal.querySelector('.photo-zoom-close');
        closeBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            closeModal();
        }, true);
        
        // Click on background (outside container) to close
        const container = modal.querySelector('.photo-zoom-container');
        modal.addEventListener('click', (e) => {
            if (e.target === modal || (e.target !== container && !container.contains(e.target))) {
                closeModal();
            }
        }, false);
        
        // Keyboard escape to close
        const handleEscape = (e) => {
            if (e.key === 'Escape') {
                closeModal();
            }
        };
        
        document.addEventListener('keydown', handleEscape);
    }
    
    // Initialize on page load and when tab content changes
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initPhotoZoom);
    } else {
        initPhotoZoom();
    }
    
    // Re-initialize when tab switches to photography
    document.addEventListener('click', function(e) {
        if (e.target.matches('[data-tab="photography"]')) {
            setTimeout(initPhotoZoom, 100);
        }
    });
})();

/* ========================================
   Monitor Animation Enhancement
   ======================================== */
(function() {
    // Initialize monitor carousel animation on page load
    function initMonitorAnimation() {
        const monitor = document.querySelector('.contact-monitor');
        if (!monitor) return;
        
        // Optional: Add intersection observer to restart animation when monitor comes into view
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    // Monitor is in view - animation will play automatically
                    monitor.style.opacity = '1';
                }
            });
        }, {
            threshold: 0.3,
            rootMargin: '0px'
        });
        
        observer.observe(monitor);
    }
    
    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initMonitorAnimation);
    } else {
        initMonitorAnimation();
    }
})();

/* ========================================
   Carousel Animation (merged from carousel-animation.js)
   Note: Disabled to allow CSS-based carouselReveal animations
   to handle the monitor display without interference
   ======================================== */
(function() {
    const carouselItems = document.querySelectorAll('.carousel-item');
    
    if (!carouselItems.length) {
        console.log('Carousel items not found');
        return;
    }
    
    // CSS animations (carouselReveal) handle the carousel display
    // No JavaScript manipulation needed - let CSS keyframes control visibility
    // This preserves the original animation behavior exactly as designed
})();

/* ==========================================================================
   Next-Taxonomy Aesthetics & Text Visualisation Engine
   Cloned from: https://next-taxonomy-191759.framer.app/
   ========================================================================== */
(function() {
    function initNextTaxonomyVisuals() {
        // 1. Config for all portfolio sections matching Next-Taxonomy numbered hierarchy
        const sectionBadges = [
            { id: 'about', num: '01', pill: 'PROFILE — EXECUTIVE SUMMARY', kicker: 'Professional', title: 'Summary' },
            { id: 'experience', num: '02', pill: 'CAREER — WORK EXPERIENCE', kicker: 'Work', title: 'Experience' },
            { id: 'education', num: '03', pill: 'ACADEMICS — FORMAL EDUCATION', kicker: 'Academic', title: 'Education' },
            { id: 'skills', num: '04', pill: 'STACK — TECHNICAL EXPERTISE', kicker: 'Technical', title: 'Skills' },
            { id: 'other-skills', num: '05', pill: 'CAPABILITIES — COMPLEMENTARY SKILLS', kicker: 'Applied', title: 'Competencies' },
            { id: 'language-proficiency', num: '06', pill: 'COMMUNICATION — GLOBAL LANGUAGES', kicker: 'Language', title: 'Proficiency' },
            { id: 'core-competencies', num: '07', pill: 'INFRASTRUCTURE — CORE PILLARS', kicker: 'Core', title: 'Competencies' },
            { id: 'projects', num: '08', pill: 'SHOWCASE — FEATURED WORK', kicker: 'Featured', title: 'Projects' },
            { id: 'portfolio', num: '09', pill: 'ARCHIVE — RESEARCH & ACHIEVEMENTS', kicker: 'Creative', title: 'Portfolio' },
            { id: 'about-myself', num: '10', pill: 'BIOGRAPHY — PERSONAL BACKGROUND', kicker: 'About', title: 'Myself' },
            { id: 'contact', num: '11', pill: 'CONNECT — GET IN TOUCH', kicker: "Let's", title: 'Work Together' },
            { id: 'quote', num: '12', pill: 'PHILOSOPHY — WORDS OF INSPIRATION', kicker: 'Favorite', title: 'Quotes' }
        ];

        sectionBadges.forEach(item => {
            const section = document.getElementById(item.id);
            if (!section) return;

            // Find or locate title element
            let titleEl = section.querySelector('.section-title');
            if (!titleEl && item.id === 'contact') {
                titleEl = section.querySelector('.contact-info h3');
                if (titleEl) {
                    titleEl.classList.add('section-title');
                }
            }
            if (!titleEl) return;

            // Inject Next-Taxonomy badge if not already present
            if (!section.querySelector('.taxonomy-section-badge')) {
                const badge = document.createElement('div');
                badge.className = 'taxonomy-section-badge';
                badge.setAttribute('aria-hidden', 'true');
                badge.innerHTML = `<span class="taxonomy-num">${item.num}</span><span class="taxonomy-pill">${item.pill}</span>`;
                titleEl.parentNode.insertBefore(badge, titleEl);
            }

            // Apply masked text reveal wrappers if not already applied
            if (!titleEl.querySelector('.text-reveal-line-inner')) {
                titleEl.innerHTML = `
                    <span class="text-reveal-line-wrap">
                        <span class="text-reveal-line-inner">
                            <span class="taxonomy-serif-kicker">${item.kicker}</span> ${item.title}
                        </span>
                    </span>
                `;
            }
        });

        // 2. Wrap any other orphan section-titles (e.g. "Here's What I'm Doing")
        document.querySelectorAll('.section-title').forEach(title => {
            if (title.offsetParent === null && title.style.display === 'none') return;
            if (!title.querySelector('.text-reveal-line-inner')) {
                const text = title.textContent.trim();
                if (!text) return;
                const parts = text.split(' ');
                const first = parts.shift();
                const rest = parts.join(' ');
                title.innerHTML = `
                    <span class="text-reveal-line-wrap">
                        <span class="text-reveal-line-inner">
                            <span class="taxonomy-serif-kicker">${first}</span> ${rest}
                        </span>
                    </span>
                `;
            }
        });

        // 3. IntersectionObserver for Next-Taxonomy masked line reveals & badges
        const revealObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const badge = entry.target.querySelector('.taxonomy-section-badge');
                    if (badge) badge.classList.add('revealed');

                    const inners = entry.target.querySelectorAll('.text-reveal-line-inner');
                    inners.forEach((inner, idx) => {
                        setTimeout(() => {
                            inner.classList.add('revealed');
                        }, 100 + idx * 80);
                    });
                }
            });
        }, {
            threshold: 0.1,
            rootMargin: '0px 0px -40px 0px'
        });

        // Observe all sections and achievement divs
        document.querySelectorAll('section, .achievements-section').forEach(sec => {
            revealObserver.observe(sec);

            // Immediate reveal check if already visible on page load
            const rect = sec.getBoundingClientRect();
            if (rect.top < window.innerHeight && rect.bottom > 0) {
                const badge = sec.querySelector('.taxonomy-section-badge');
                if (badge) badge.classList.add('revealed');
                const inners = sec.querySelectorAll('.text-reveal-line-inner');
                inners.forEach(inner => inner.classList.add('revealed'));
            }
        });

        // Click to explore scroll indicator smoothly jumps to about
        const scrollExplore = document.querySelector('.hero-section .scroll-indicator');
        if (scrollExplore && !scrollExplore.dataset.bound) {
            scrollExplore.dataset.bound = 'true';
            scrollExplore.addEventListener('click', () => {
                const aboutSec = document.getElementById('about');
                if (aboutSec) {
                    aboutSec.scrollIntoView({ behavior: 'smooth' });
                }
            });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initNextTaxonomyVisuals);
    } else {
        initNextTaxonomyVisuals();
    }
})();