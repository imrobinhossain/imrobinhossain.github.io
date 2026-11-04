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
        if (document.body) {
            document.body.classList.toggle('light-mode', theme === 'light');
        }
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

// --- ACETERNITY BACKGROUND RIPPLE EFFECT SYSTEM ---
let backgroundCanvas, backgroundCtx;
let mousePos = { x: null, y: null };
let rippleGrid = { cellSize: 56, cols: 0, rows: 0, ripples: [], mouseCol: -1, mouseRow: -1 };

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
        const isRing = !!el?.closest("a, button, [role~='button'], .btn, .nav-link, .portfolio-tab, .accordion-header, .social-link, .kokonut-pull-cord, .clickable, input, textarea, select, .project-card, .achievements-card, .skill-item, .dossier-tab-btn, .dossier-card-root, .dossier-btn-primary, .dossier-btn-secondary, .fa-tab-btn, .fa-primary-cta, .fa-secondary-cta, .fa-nav-btn");
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

// Interactive Preloader functionality (Greeting Loader - greatingloader.framer.website)
function initPreloader() {
    const preloader = document.getElementById('preloader');
    const reel = document.getElementById('greetingReel');
    
    // Always lock scrolling and hide navbar/sidebars during preloader
    document.body.classList.add('preloader-active');
    
    if (!preloader || !reel) {
        document.body.classList.remove('preloader-active');
        return;
    }

    // Cubic-bezier solver matching Framer component cubic-bezier(0.68, 0, 0.22, 0.98)
    function solveCubicBezier(p1x, p1y, p2x, p2y) {
        return function(t) {
            if (t <= 0) return 0;
            if (t >= 1) return 1;
            let s = t;
            for (let i = 0; i < 8; i++) {
                const currentX = 3 * (1 - s) * (1 - s) * s * p1x + 3 * (1 - s) * s * s * p2x + s * s * s;
                const dx = 3 * (1 - s) * (1 - s) * p1x + 6 * (1 - s) * s * (p2x - p1x) + 3 * s * s * (1 - p2x);
                if (Math.abs(currentX - t) < 1e-5 || Math.abs(dx) < 1e-5) break;
                s -= (currentX - t) / dx;
            }
            return 3 * (1 - s) * (1 - s) * s * p1y + 3 * (1 - s) * s * s * p2y + s * s * s;
        };
    }

    const rawWords = [
        { word: 'Hello', lang: 'en' },
        { word: 'Hola', lang: 'es' },
        { word: 'Bonjour', lang: 'fr' },
        { word: 'Ciao', lang: 'it' },
        { word: 'Hallo', lang: 'de' },
        { word: 'مرحبا', lang: 'ar' },
        { word: 'হ্যালো', lang: 'bn' }
    ];

    // Reorder so user browser language is the final destination word
    const words = [...rawWords];
    const userLangs = (navigator.languages || [navigator.language || 'en']).map(function(l) {
        return (l || '').split('-')[0].toLowerCase();
    });
    let matchedIdx = -1;
    for (let j = 0; j < userLangs.length; j++) {
        const ul = userLangs[j];
        matchedIdx = words.findIndex(function(w) { return w.lang === ul; });
        if (matchedIdx !== -1) break;
    }
    if (matchedIdx !== -1 && matchedIdx !== words.length - 1) {
        const item = words.splice(matchedIdx, 1)[0];
        words.push(item);
    }

    // Sequence padding matching Framer implementation
    const padCount = Math.ceil(4 / words.length);
    const padding = Array(padCount).fill(words).flat();
    const sequence = [].concat(padding, words, padding);
    const startIndex = padding.length;
    const endIndex = startIndex + words.length - 1;

    // Responsive word spacing in rem
    const isMobile = window.innerWidth < 560;
    const spacingRem = isMobile ? 4.8 : 5.8;

    // Populate reel
    reel.innerHTML = '';
    const elements = sequence.map(function(item) {
        const el = document.createElement('div');
        el.className = 'greeting-word';
        el.textContent = item.word;
        reel.appendChild(el);
        return el;
    });

    const easeFn = solveCubicBezier(0.68, 0, 0.22, 0.98);
    const duration = 2400; // ms scroll duration
    let startTime = null;
    let animCompleted = false;

    function renderFrame(progress) {
        for (let i = 0; i < elements.length; i++) {
            const el = elements[i];
            const diff = i - progress;
            const dist = Math.abs(diff);

            if (dist > 3) {
                el.style.opacity = '0';
                el.style.visibility = 'hidden';
                continue;
            }

            let opacity = 0;
            if (dist <= 1) {
                opacity = 1.0 + (0.35 - 1.0) * dist;
            } else if (dist <= 2) {
                opacity = 0.35 + (0.18 - 0.35) * (dist - 1);
            } else {
                opacity = 0.18 * (1 - (dist - 2));
            }

            let blur = 0;
            if (dist <= 1) {
                blur = 0 + (3.0 - 0) * dist;
            } else if (dist <= 2) {
                blur = 3.0 + (6.0 - 3.0) * (dist - 1);
            } else {
                blur = 6.0;
            }

            const yRem = diff * spacingRem;
            el.style.visibility = 'visible';
            el.style.opacity = Math.max(0, opacity).toFixed(3);
            el.style.filter = 'blur(' + blur.toFixed(1) + 'px)';
            el.style.transform = 'translate3d(-50%, calc(-50% + ' + yRem.toFixed(2) + 'rem), 0)';
        }
    }

    function completeExit() {
        if (animCompleted) return;
        animCompleted = true;

        // Exit transition: reel drifts up with blur and fade
        reel.style.transition = 'transform 0.65s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.65s ease, filter 0.65s ease';
        reel.style.transform = 'translate(-50%, calc(-50% - 28px))';
        reel.style.opacity = '0';
        reel.style.filter = 'blur(12px)';

        setTimeout(function() {
            preloader.classList.add('fade-out');
            setTimeout(function() {
                preloader.style.display = 'none';
                preloader.setAttribute('aria-hidden', 'true');
                document.body.classList.remove('preloader-active');

                // Animate hero content
                setTimeout(function() {
                    const heroItems = document.querySelectorAll('.hero-content > *');
                    heroItems.forEach(function(el, index) {
                        el.style.animationDelay = (index * 0.2) + 's';
                        el.classList.add('fade-in');
                    });
                }, 100);
            }, 550);
        }, 250);
    }

    function step(now) {
        if (!startTime) startTime = now;
        const elapsed = now - startTime;
        const t = Math.min(1, elapsed / duration);
        const progress = startIndex + (endIndex - startIndex) * easeFn(t);

        renderFrame(progress);

        if (t < 1) {
            requestAnimationFrame(step);
        } else {
            // Pause on final greeting then initiate exit
            setTimeout(completeExit, 300);
        }
    }

    // Safety fallback: dismiss after 4s
    setTimeout(completeExit, 4000);

    requestAnimationFrame(step);
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
    initFooterAnimatedUnderlink();
    
    initNavigation();
    initDriftTimeline();
    initKineticTextSwapper();
    initHeroShaderBg();
    initScrollAnimations();
    initStickyHeader();
    initProfileImageTransition();
    initScrollToTopButton();
    initPillScrollBar();
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

    // =========================================================================
    // Quotes Text Visualization — Framer Text Reveal Style
    // Reference: https://lucky-event-452312.framer.app (NR – Text Reveal)
    // =========================================================================
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
            text: `Nothing is impossible. Because 'impossible' says that "I-m-possible."`,
            author: 'Audrey Hepburn'
        },
        {
            text: `What are you afraid of losing when nothing in the world actually belongs to you?`,
            author: 'Marcus Aurelius'
        },
        {
            text: `Everything that happens helps you grow, even if it's hard to see right now.`,
            author: 'Austin Mahone'
        }
    ];

    const nrQuoteSection = document.getElementById('quote');
    const nrQuoteText = document.getElementById('nrQuoteText') || document.querySelector('.nr-quote-text') || document.querySelector('.quote-text');
    const nrAuthorName = document.getElementById('nrAuthorName') || document.querySelector('.nr-author-name') || document.querySelector('.author-name');
    let nrQuoteIndex = 0;
    let nrRotateTimer = null;

    function renderNrQuoteWords(text) {
        if (!nrQuoteText) return;
        const words = text.trim().split(/\s+/).filter(Boolean);
        const html = words.map((word, idx) => {
            const isFirst = (idx === 0);
            const isLast = (idx === words.length - 1);
            let displayWord = word;
            if (isFirst && !displayWord.startsWith('"')) displayWord = '"' + displayWord;
            if (isLast && !displayWord.endsWith('"')) displayWord = displayWord + '"';
            return `<span class="nr-word-wrap"><span class="nr-word" style="--word-idx: ${idx}">${displayWord} </span></span>`;
        }).join('');
        nrQuoteText.innerHTML = html;
    }


    // =========================================================================
    // Authentic Framer Handwriting Engine for Author Name
    // Source: https://handwriting.framer.website
    // =========================================================================
    const framerHandwritingGlyphs = {a:{minX:10,width:27.3,paths:[`M33.07,51.39s-5.37-11.42-12.72-2.6c-7.36,8.83-13.67,17.22-8.39,21.11,5.28,3.89,21.63-17.57,21.63-17.57,0,0-4.85,15.06,5.11,17.31`]},ae:{minX:10,width:29.4,paths:[`M33.07,51.39s-5.37-11.42-12.72-2.6c-7.36,8.83-13.67,17.22-8.39,21.11s21.63-17.57,21.63-17.57c0,0-4.85,15.06,5.11,17.31`,`M24.88,34.74L26.33,32.88`,`M37.84,35.37L39.39,32.88`]},b:{minX:10,width:25.1,paths:[`M23.85,21.97s-12.12,25.96-13.85,40.41c0,0,17.57-20.34,23.8-12.37,6.23,7.96-10.82,20.51-19.3,22.15`]},c:{minX:10,width:17.7,paths:[`M27.04,52.78s2.94-9.43-6.66-5.71c-9.61,3.72-13.15,19.99-8.05,23.88,5.11,3.89,15.14-6.32,15.14-6.32`]},"cap-a":{minX:10,width:35.1,paths:[`M10,75.29S37.42,20.18,43.13,19.98s2.97,12.15,1.4,32.28-1.01,22.03-1.01,22.03`,`M15.23,55.06s15.43-3.8,25.39-4.36`]},"cap-ae":{minX:10,width:45.5,paths:[`M10,75.88S37.42,20.76,43.13,20.56s2.97,12.15,1.4,32.28c-1.57,20.13-1.01,22.03-1.01,22.03`,`M15.23,55.64s15.43-3.8,25.39-4.36`,`M40.62,8.19L43.05,5.63`,`M54.17,8.19L55.45,5.63`]},"cap-b":{minX:10.5,width:35.9,paths:[`M28.79,22.18s-13.64,31.09-18.79,47.42`,`M22.75,23.07s24.38-6.29,23.71,4.47c-.67,10.76-15.21,21.58-25.39,22.26,0,0,22.93-4.14,23.26,7.05s-11.63,30.08-29.52,19.24`]},"cap-c":{minX:10,width:37.1,paths:[`M47.18,22.18l-5.05,16.45s3.17-16.84-5.55-17.93S4.19,51.24,11.32,69.6c7.13,18.36,25.46-1.85,25.46-1.85`]},"cap-d":{minX:10.5,width:43.2,paths:[`M28.51,21.33s-13.84,29.13-18.51,51.5`,`M14.67,21.33s27.84-7.72,36.85,11.59c9.01,19.31-10.78,42.27-39.1,44.39`]},"cap-e":{minX:9.6,width:41.4,paths:[`M30.32,23.26S2.8,58.18,11.81,69.93c9.01,11.75,32.67-3.54,32.67-3.54`,`M25.32,26.59s17.25-4.55,26.58-4.55`,`M19.6,48.82L41.75,44.62`]},"cap-f":{minX:10.4,width:36.2,paths:[`M30.16,19.96S13.36,56.74,10,74.37`,`M18.74,25.34s17.34-2.4,33.46-2.08`,`M18.06,47.17s11.96,1.8,23.11,0`]},"cap-g":{minX:10.1,width:34.5,paths:[`M44.6,25.34S25.12,5.29,13.02,47.97c-12.09,42.68,15.45,31.26,24.06,14.59,8.6-16.66-8.33-12.9-8.33-12.9`]},"cap-h":{minX:10.5,width:48.3,paths:[`M30.02,17.81s-15.72,31.31-20.02,61.01`,`M58.78,20.63s-13.3,41.93-17.07,58.19`,`M20.62,46.84s27.41,3.49,33.06,5.64`]},"cap-i":{minX:10,width:41.5,paths:[`M23.04,26.41s16.4-3.9,29.83-3.63`,`M10,75.29s19.35-.9,26.74-1.71`,`M38.09,21.98L21.02,76.81`]},"cap-j":{minX:22,width:23,paths:[`M34.19,20.63l12.9-1.48s-13.57,44.88-22.44,62.09c-8.87,17.2-14.65,6.32-14.65,6.32`]},"cap-k":{minX:10,width:43.1,paths:[`M53.14,26.41s-26,16.5-31.31,23.65c0,0,9.81,13.71,21.77,26.07`,`M29.62,19.16L10,76.13`]},"cap-l":{minX:10,width:22.5,paths:[`M29.86,22.77s-14.24,21.25-17.74,33.07c-3.24,10.98-6.45,24.19,20.43,17.6`]},"cap-m":{minX:10,width:59,paths:[`M10,74.66s25.94-51.6,28.62-49.86-8.74,41.26-3.49,44.08,31.85-47.57,33.87-47.17-9.31,48.23-8.74,52.95`]},"cap-n":{minX:10,width:47.5,paths:[`M10,74.66s14.38-43.41,23.25-50.66c0,0-1.48,30.77,4.3,43.41,5.78,12.63,20.02-44.63,20.02-44.63`]},"cap-o":{minX:10,width:35.4,paths:[`M35.86,22.77s-15.59,3.1-21.77,22.86c-6.18,19.75-5.38,29.03,2.55,30.91s26.47-15.86,28.76-33.6-10.08-21.24-10.08-21.24`]},"cap-oe":{minX:10,width:40,paths:[`M35.86,21.97s-15.59,3.1-21.77,22.86c-6.18,19.75-5.38,29.03,2.55,30.91s26.47-15.86,28.76-33.6-10.08-21.24-10.08-21.24`,`M34.95,8.19L36.66,6.2`,`M48.49,7.99L50.05,6.2`]},"cap-p":{minX:10.4,width:36.8,paths:[`M30.43,22.77S13.9,58.19,10,75.29`,`M28.14,23.86s18.28-7.39,19.08,2.96c.81,10.35-9.41,26.74-27.01,24.73`]},"cap-q":{minX:10,width:32.6,paths:[`M35.26,21.3s-16.4,1.89-22.17,25c-5.78,23.11-2.69,30.64,3.09,32.52s20.16-12.09,26.47-38.17-14.11-19.36-14.11-19.36`,`M22.22,64.04L31.36,82.59`]},"cap-r":{minX:10.3,width:35.8,paths:[`M26.13,21.3s-13.84,37.63-16.13,50.67`,`M21.69,22.77s23.38-2.54,24.32,10.9c.94,13.44-20.02,24.86-24.32,24.73,0,0,13.98,10.89,17.34,14.92`]},"cap-s":{minX:10,width:35.9,paths:[`M40.64,31.92s10.62-9.42,0-10.62-22.44,3.9-20.56,15.32,15.99,37.42,3.09,38.67-13.17-12.19-13.17-12.19`]},"cap-t":{minX:10,width:31.4,paths:[`M10,26.55s22.44-3.09,32.39-1.21`,`M27.6,25.34L10.81,75.29`]},"cap-u":{minX:9.8,width:38.9,paths:[`M24.81,19.02S5.86,56.38,10.83,69.28s28.22,4.57,38.97-46.09`]},"cap-ue":{minX:9.8,width:38.3,paths:[`M24.81,19.64S5.86,57,10.83,69.9c4.97,12.9,28.22,4.57,38.97-46.09`,`M32.81,8.48L34.66,6.06`,`M45.95,9.12L47.99,6.06`]},"cap-v":{minX:10,width:33.1,paths:[`M10,24.73s2.42,37.03,2.55,46.84c0,0,17.07-29.3,32.92-50.26`]},"cap-w":{minX:9.9,width:46.2,paths:[`M17.07,22.78s-9.54,40.32-6.45,46.63c3.09,6.32,24.46-36.82,24.46-36.82,0,0-7.53,37.8-3.49,40.32s22.58-34.94,24.73-46.63`]},"cap-x":{minX:13,width:42.3,paths:[`M26.66,22.78s6.45,51.34,18.55,51.34`,`M55.29,22.78s-14.78,22.91-45.29,52.51`]},"cap-y":{minX:10,width:31.2,paths:[`M10,19.56s4.43,19.75,13.04,28.89`,`M41.18,22.78s-24.06,32.52-29.56,53.89`]},"cap-z":{minX:12,width:40.2,paths:[`M22.9,25.34s23.11-2.42,31.31,0c0,0-36.82,33.46-44.21,47.57,0,0,16.4-4.7,32.92-5.64`]},d:{minX:10,width:28,paths:[`M41.74,22.84s-14.54,33.84-15.14,50.71c0,0,9-29.94-3.2-26.74-12.2,3.2-15.66,20.86-12.03,23.19,3.63,2.34,7.53-1.47,7.53-1.47`]},e:{minX:12.6,width:16.4,paths:[`M12.6,55.46s9.69,5.54,14.88-.95c5.19-6.49-3.37-15.32-12.46-4.85s-6.14,32.02,11.34,17.13`]},f:{minX:10.2,width:22,paths:[`M37.26,30.97s7.01-11.6-4.15-9.26S11.3,61.6,10,79.86`,`M14.85,51.91L28.78,49.06`]},g:{minX:10,width:25.1,paths:[`M33.45,55.29s4.76-10.7-4.15-10.67-17.74,15.69-16.1,19.84,19.9-8.39,19.9-8.39c0,0-7.1,32.62-14.11,32.11s-9-4.15-9-4.15`]},h:{minX:10,width:24.8,paths:[`M25.32,23.36l-15.32,45.35s16.44-19.12,21.81-17.22.26,19.47,2.25,20.25`]},i:{minX:10,width:8,paths:[`M15.28,51.39L10,70.6`,`M19,36.34L20.64,33.13`]},j:{minX:24,width:14,paths:[`M32.16,47.5s-2.73,27.98-10,38.14c-7.27,10.16-10.66,5.64-12.16-1.25`,`M35.95,30.72L37.46,28.58`]},k:{minX:10.2,width:22.6,paths:[`M25.8,25.7s-14.29,33.6-15.8,44.39`,`M32.82,45.39s-13.54,10.53-16.17,12.04c0,0,7.65,14.17,11.91,15.17`]},l:{minX:10.5,width:12,paths:[`M27.43,25.7s-12.91,16.8-17.43,48.15`]},m:{minX:10,width:37.6,paths:[`M15.02,44.62s.5,1.15,0,4.16c-.5,3.01-5.02,20.77-5.02,20.77,0,0,16.18-19.51,20.19-17.76s-3.39,16.43-3.39,16.43c0,0,14.54-13.67,17.43-13.17,2.88.5.13,13.54,3.89,15.05`]},n:{minX:10,width:19.4,paths:[`M14.51,46.26s.75,2.26-1,7.77c-1.76,5.52-3.51,10.91-3.51,10.91,0,0,16.3-15.05,19.43-13.04s-2.13,16.17,0,19.81`]},"num-0":{minX:10,width:26,paths:[`M32.89,32.46s-18.52-.95-22.39,22.74c-3.88,23.68,16.08,16.36,21.39,6.32s8.32-25.26,0-29.85`]},"num-1":{minX:10,width:22.7,paths:[`M10,45.44s19.81-14.07,22.68-14.5c0,0-11.34,35.74-12.49,42.2`]},"num-2":{minX:10,width:24.5,paths:[`M16.6,36.11s10.62-7.46,16.51,0c5.88,7.46-23.11,33.87-23.11,33.87,0,0,13.78-4.74,26.41-2.58`]},"num-3":{minX:11.2,width:23.8,paths:[`M16.67,32.8s17.8-5.87,18.37,1.31-18.37,15.5-18.37,15.5c0,0,16.08,3.01,15.07,11.05-1,8.04-13.96,12.07-21.74,10.08`]},"num-4":{minX:9.9,width:26.3,paths:[`M21.79,29.34s-14.57,20.58-11.31,23.55,17.31-2.27,17.31-2.27`,`M36.18,32.54s-17.78,31.36-14.98,40.4`]},"num-5":{minX:10.4,width:24.7,paths:[`M20.84,32.54s-4.61,8.97-3.84,11.1,16.3-1.71,14.42,13.57-18.01,16.47-21.42,12.38`,`M19.02,33.57s12.55-5.21,16.47-1.79`]},"num-6":{minX:10,width:25.4,paths:[`M34.86,32.89s-7.34-2.05-14.08,6.91c-6.74,8.96-14.68,25.35-8.62,29.7,6.06,4.35,25.35-6.49,23.04-16.9-2.3-10.41-20.48-1.02-20.48-1.02`]},"num-7":{minX:10,width:21.2,paths:[`M13.24,33.4s16.73-5.52,17.92-.71-20.74,28.96-21.17,40.74`,`M10,51.24s13.31-.09,17.07,3.76`]},"num-8":{minX:10.6,width:29.4,paths:[`M34.51,31.95s-16.3-6.49-16.81,5.12c-.51,11.61,13.23,15.87,12.2,25.94s-16.04,15.19-19.29,11.44,6.83-22.7,17.67-26.2c10.84-3.5,16.3-8.62,6.83-15.96`]},"num-9":{minX:10,width:20.6,paths:[`M30.55,32.63s-2.99-6.77-10.33-2.49c-7.34,4.28-16.56,14.78-4.1,18.02,0,0,6.4,4.1,14.42-12.97,0,0-16.81,27.4-14.51,39.34l1.45-.51`]},o:{minX:10,width:19.7,paths:[`M24.79,46.26s-13.42,4.26-14.67,15.92c-1.25,11.66,7.27,10.78,15.3,1.76,8.02-9.03,3.26-17.45-1.76-17.68`]},oe:{minX:10.1,width:24.5,paths:[`M24.79,46.26s-13.42,4.26-14.67,15.92,7.27,10.78,15.3,1.76c8.02-9.03,3.26-17.45-1.76-17.68`,`M19.45,35.37L21.32,32.46`,`M32.72,35.37L34.58,32.46`]},p:{minX:10,width:29.3,paths:[`M26.68,39.87s-14.17,37.37-16.68,50.66c0,0,9.91-38.37,14.04-40,4.14-1.63,14.17-5.27,15.3-.88s-2.88,17.93-20.19,15.55`]},q:{minX:10,width:22.6,paths:[`M31.95,46.89s-7.15-5.64-16.93,5.77c-9.78,11.41-3.26,14.8,2.63,11.66,5.89-3.13,11.91-6.9,14.92-15.67,0,0-13.92,22.69-12.66,44.14`]},r:{minX:10,width:20.1,paths:[`M12.51,47.27s3.01.38,3.01,2.88-5.52,19.56-5.52,19.56c0,0,12.91-24.73,18.31-24.22l1.76,4.15`]},s:{minX:10,width:21.8,paths:[`M31.44,50.02s1.88-5.43-4.89-5.41-16.8,8.42-13.04,14.06,12.71,7.52,8.68,11.91-12.19,1.13-12.19,1.13`]},"sign-and":{minX:10,width:44.3,paths:[`M54.3,78.63s-5.97.34-17.07-13.14c-11.09-13.48-19.71-21.85-17.07-30.04,2.65-8.19,7.85-15.02,15.28-11.95s6.91,5.97,4.69,9.3-30.55,25.35-30.13,33.46,13.74,6.66,17.75,3.84c4.01-2.82,16.56-12.72,25.35-20.82`]},"sign-apostroph":{minX:4,width:13,paths:[`M15.78,19.49s-7.77,9.56-5.29,13.83,4.27-.68,4.27-.68c0,0,.17-3.33-3.07-1.19`]},"sign-at":{minX:10,width:46.3,paths:[`M40.34,59.43s2.05-10.75-7.68-8.36-9.81,15.96-7.94,17.58,9.49,4.78,15.8-7.34c0,0-1.97,5.12,2.21,6.66s17.41-9.64,12.46-21.85c-4.95-12.2-15.45-13.4-23.56-9.47-8.11,3.93-20.99,13.74-21.59,26.88-.6,13.14,5.8,17.92,17.84,19.71`]},"sign-comma":{minX:10.5,width:5.2,paths:[`M15.63,67.28s-.85,8.19-5.63,12.89`]},"sign-dollar":{minX:10.4,width:38.3,paths:[`M48.75,29.22s-6.14-3.33-13.83-.43c-7.68,2.9-9.81,7.68-8.96,10.5s9.64,11.69,10.67,14.42c1.02,2.73,2.3,8.96-3.07,11.69-5.38,2.73-21.51,9.05-23.56-1.62`,`M47.72,14.03s-14.85,30.81-18.95,39.34c-4.1,8.53-11.27,26.37-11.52,30.13`]},"sign-dot":{minX:10,width:5,paths:[`M10,67.28L11.37,66.26`]},"sign-equal":{minX:10,width:25,paths:[`M14.35,49.53L35.01,49.1`,`M10,61.91L30.65,61.48`]},"sign-euro":{minX:10,width:42,paths:[`M51.07,35.41s3.08-11.54-4.23-12.38c-7.31-.85-21.77,11.61-27.77,28.54-6,16.92-2.77,21.15,2.69,23.23,5.46,2.08,23.15-6.77,23.15-6.77`,`M14.62,44.62s23.23-.29,25.38.64`,`M10,57.13s23.92-.03,26,.66`]},"sign-exclamation":{minX:10,width:19.6,paths:[`M29.63,15.65s-3.41,11.27-7.85,21.34-6.32,17.67-6.32,20.48`,`M11.11,70.1L10,71.29`]},"sign-minus":{minX:10,width:16,paths:[`M10,57.72L25.96,57.08`]},"sign-paragraph":{minX:10.7,width:26.6,paths:[`M36.12,33.83s3.58-8.02-3.41-7.17-13.31,9.39-9.05,15.53c4.27,6.14,12.12,18.26-3.93,14.08`,`M22.89,42.7s-11.95,7-7,15.28c4.95,8.28,7,10.67,5.12,12.29-1.88,1.62-6.32,4.27-11.01,1.19`]},"sign-plus":{minX:10,width:26.5,paths:[`M23.48,43.04L23.83,71.12`,`M10,57.72L36.54,57.08`]},"sign-question":{minX:10,width:22.5,paths:[`M16.14,30.16s-2.56-13.31,11.01-14.51,10.41,16.13.43,24.84c-9.99,8.71-12.38,9.99-13.06,15.96`,`M11.45,70.1L10,71.72`]},"sign-quote-close":{minX:4,width:25,paths:[`M15.78,19.49s-7.77,9.56-5.29,13.83,4.27-.68,4.27-.68c0,0,.17-3.33-3.07-1.19`,`M30.88,19.06s-7.08,8.53-6.23,13.4c.85,4.86,5.04,3.24,5.8,1.37s-1.62-4.35-3.67-2.65`]},"sign-quote-eng-close":{minX:5,width:25,paths:[`M14.52,20.44s-2.82-1.62-3.16,0-.34,5.89,4.01,3.33c0,0-2.48,6.83-5.38,10.92`,`M31.76,20.35s-4.52-2.73-5.21.43,1.62,2.99,4.1,2.05c0,0-1.45,7.94-5.46,12.46`]},"sign-quote-open":{minX:10.4,width:21.3,paths:[`M14.52,67.79s-2.82-1.62-3.16,0-.34,5.89,4.01,3.33c0,0-2.48,6.83-5.38,10.92`,`M31.76,67.71s-4.52-2.73-5.21.43,1.62,2.99,4.1,2.05c0,0-1.45,7.94-5.46,12.46`]},"sign-slash":{minX:10.2,width:33.7,paths:[`M43.97,14.54S11.71,72.32,10,80.77`]},sz:{minX:10,width:35.3,paths:[`M10,89.94s3.73-38.75,16.08-56.33,20.96-10.84,19.09-4.09c-1.87,6.75-13.92,18.8-13.78,20.38s15.5,23.68-5.31,19.95`]},t:{minX:10,width:14,paths:[`M24.68,29.84s-14.29,21.32-14.67,33.23c-.38,11.91,7.27,10.53,16.55,5.52`,`M10.51,42.75s15.92-.88,19.81-.75`]},u:{minX:9.6,width:20.8,paths:[`M16.09,45.49s-11.16,21.21-3.26,24.22,17.55-22.19,17.55-22.19c0,0-8.65,13.99-2.26,25.36`]},ue:{minX:9.6,width:26.3,paths:[`M16.09,45.49s-11.16,21.21-3.26,24.22c7.9,3.01,17.55-22.19,17.55-22.19,0,0-8.65,13.99-2.26,25.36`,`M22.69,32.46L21.13,34.74`,`M35.85,32.46L34.29,34.74`]},v:{minX:10,width:17.4,paths:[`M10,46.89s.31,18.19,2.63,22.19,14.8-18.93,14.8-18.93`]},w:{minX:9.9,width:32.6,paths:[`M10.06,45.49s-.63,24.03,2.26,24.06,13.54-15.64,14.29-21.91c0,0-2.63,21.37,2.01,21.91s13.92-21.03,13.92-21.03`]},x:{minX:10,width:22.7,paths:[`M15.39,47.39s8.15,22.57,17.3,25.45`,`M32.69,48.14L10,69.56`]},y:{minX:13.1,width:24.7,paths:[`M23.04,44.62s-9.31,21.7-2.26,23.21c7.06,1.51,14.29-5.44,17.05-22.34,0,0-6.02,50.05-27.84,49.05`]},z:{minX:10,width:11,paths:[`M13.32,44.62s13.54-.36,14.42,2.78-19.56,20.06-17.3,23.82c2.26,3.76,17.33-1.63,17.33-1.63`]}};

    function mapHandwritingChar(c) {
        if (c === 'ä') return 'ae';
        if (c === 'ö') return 'oe';
        if (c === 'ü') return 'ue';
        if (c === 'Ä') return 'cap-ae';
        if (c === 'Ö') return 'cap-oe';
        if (c === 'Ü') return 'cap-ue';
        if (c === 'ß') return 'sz';
        if (c >= 'A' && c <= 'Z') return 'cap-' + c.toLowerCase();
        if (c >= 'a' && c <= 'z') return c;
        if (c >= '0' && c <= '9') return 'num-' + c;
        if ("'’‘`´ʼʻ".includes(c)) return 'sign-apostroph';
        if ('"”'.includes(c)) return 'sign-quote-close';
        if (c === '„') return 'sign-quote-open';
        if (c === '“') return 'sign-quote-eng-close';
        switch (c) {
            case '.': return 'sign-dot';
            case ',': return 'sign-comma';
            case '!': return 'sign-exclamation';
            case '?': return 'sign-question';
            case '&': return 'sign-and';
            case '@': return 'sign-at';
            case '+': return 'sign-plus';
            case '-': case '—': case '–': return 'sign-minus';
            case '=': return 'sign-equal';
            case '/': return 'sign-slash';
            case '$': return 'sign-dollar';
            case '§': return 'sign-paragraph';
            case '€': return 'sign-euro';
            default: return c;
        }
    }

    function renderHandwriting(container, options = {}) {
        if (!container) return;
        const text = options.text || 'Carl Sagan';
        const isMobile = window.innerWidth < 640;
        const baseSize = options.baseSize || (isMobile ? 26 : 32);
        const strokeWidth = options.strokeWidth || (isMobile ? 3.5 : 3.8);
        const letterSpacing = options.letterSpacing || 2;
        const wordSpacing = options.wordSpacing || (isMobile ? 12 : 15);
        const fontColor = options.fontColor || 'currentColor';
        const speed = options.speed || 0.12;
        const delayBetween = options.delayBetween || 0.02;

        const words = (text || '').split(' ');
        let accumulatedTime = options.initialDelay || 0.05;

        const wrapper = document.createElement('span');
        wrapper.className = 'framer-handwriting-wrap';
        wrapper.setAttribute('aria-label', text);
        wrapper.style.display = 'inline-flex';
        wrapper.style.flexDirection = 'row';
        wrapper.style.alignItems = 'baseline';
        wrapper.style.flexWrap = 'nowrap';
        wrapper.style.gap = wordSpacing + 'px';
        wrapper.style.color = fontColor;
        wrapper.style.verticalAlign = 'middle';

        const srSpan = document.createElement('span');
        srSpan.className = 'sr-only';
        srSpan.textContent = text;
        wrapper.appendChild(srSpan);

        words.forEach(word => {
            const wordDiv = document.createElement('span');
            wordDiv.className = 'framer-handwriting-word';
            wordDiv.style.display = 'inline-flex';
            wordDiv.style.flexDirection = 'row';
            wordDiv.style.alignItems = 'baseline';
            wordDiv.style.gap = letterSpacing + 'px';

            Array.from(word).forEach(char => {
                const charKey = mapHandwritingChar(char);
                const glyph = framerHandwritingGlyphs[charKey];
                const charDuration = speed;
                const charPause = delayBetween;
                const startTime = accumulatedTime;
                accumulatedTime += charDuration + charPause;

                if (!glyph) {
                    const fallbackSpan = document.createElement('span');
                    fallbackSpan.style.fontSize = (baseSize * 0.75) + 'px';
                    fallbackSpan.style.lineHeight = baseSize + 'px';
                    fallbackSpan.style.display = 'inline-block';
                    fallbackSpan.textContent = char;
                    wordDiv.appendChild(fallbackSpan);
                    return;
                }

                const svgWidth = (baseSize * glyph.width) / 100;
                const totalPaths = glyph.paths.length;

                const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                svg.setAttribute('viewBox', glyph.minX + ' 0 ' + glyph.width + ' 100');
                svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
                svg.style.width = svgWidth + 'px';
                svg.style.height = baseSize + 'px';
                svg.style.overflow = 'visible';
                svg.style.flexShrink = '0';
                svg.style.display = 'inline-block';
                svg.setAttribute('aria-hidden', 'true');

                const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
                g.setAttribute('fill', 'none');
                g.setAttribute('stroke', fontColor);
                g.setAttribute('stroke-width', strokeWidth);
                g.setAttribute('stroke-linecap', 'round');
                g.setAttribute('stroke-linejoin', 'round');

                glyph.paths.forEach((d, pathIdx) => {
                    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                    path.setAttribute('d', d);
                    path.setAttribute('pathLength', '1');
                    path.style.strokeDasharray = '1';
                    path.style.strokeDashoffset = '0';
                    path.style.opacity = '1';

                    const pathDuration = charDuration / totalPaths;
                    const pathDelay = startTime + pathIdx * pathDuration;

                    path.style.animation = `framerStrokeDraw ${pathDuration}s cubic-bezier(0.42, 0, 0.58, 1) ${pathDelay}s both`;

                    g.appendChild(path);
                });

                svg.appendChild(g);
                wordDiv.appendChild(svg);
            });

            wrapper.appendChild(wordDiv);
        });

        container.innerHTML = '';
        container.appendChild(wrapper);
    }

    function showNrQuote(index) {
        if (!nrQuoteText) return;
        const q = quotes[index];
        nrQuoteText.classList.add('nr-exiting');
        if (nrAuthorName) nrAuthorName.style.opacity = '0';

        setTimeout(() => {
            renderNrQuoteWords(q.text);
            if (nrAuthorName) {
                renderHandwriting(nrAuthorName, { text: q.author, fontColor: 'currentColor' });
                nrAuthorName.style.opacity = '1';
            }
            nrQuoteText.classList.remove('nr-exiting');
        }, 360);
    }

    // Guarantee initial render and immediate visibility
    renderNrQuoteWords(quotes[0].text);
    if (nrAuthorName) {
        renderHandwriting(nrAuthorName, { text: quotes[0].author, fontColor: 'currentColor' });
        nrAuthorName.style.opacity = '1';
    }
    if (nrQuoteSection) {
        nrQuoteSection.classList.add('nr-inview');
    }

    if (nrQuoteSection && 'IntersectionObserver' in window) {
        const nrObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    nrQuoteSection.classList.add('nr-inview');
                }
            });
        }, { threshold: [0, 0.05, 0.1], rootMargin: '150px 0px' });
        nrObserver.observe(nrQuoteSection);
    }

    function checkNrQuoteVisibility() {
        if (!nrQuoteSection) return;
        const r = nrQuoteSection.getBoundingClientRect();
        if (r.top < window.innerHeight + 150 && r.bottom > -150) {
            nrQuoteSection.classList.add('nr-inview');
        }
    }
    window.addEventListener('scroll', checkNrQuoteVisibility, { passive: true });
    window.addEventListener('resize', checkNrQuoteVisibility, { passive: true });
    setTimeout(checkNrQuoteVisibility, 200);

    function startNrQuoteRotation() {
        if (nrRotateTimer) clearInterval(nrRotateTimer);
        nrRotateTimer = setInterval(() => {
            nrQuoteIndex = (nrQuoteIndex + 1) % quotes.length;
            showNrQuote(nrQuoteIndex);
        }, 9000);
    }
    startNrQuoteRotation();

    if (nrQuoteSection) {
        nrQuoteSection.addEventListener('mouseenter', () => {
            if (nrRotateTimer) clearInterval(nrRotateTimer);
        });
        nrQuoteSection.addEventListener('mouseleave', () => {
            startNrQuoteRotation();
        });
    }

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

// --- ACETERNITY BACKGROUND RIPPLE EFFECT SYSTEM ---
// Cloned from: npx shadcn@latest add @aceternity/background-ripple-effect-demo
let cellShadowCanvas = null;
function getCellShadowCanvas() {
    if (!cellShadowCanvas) {
        cellShadowCanvas = document.createElement('canvas');
        cellShadowCanvas.width = 56;
        cellShadowCanvas.height = 56;
        const sCtx = cellShadowCanvas.getContext('2d');
        const grad = sCtx.createRadialGradient(28, 28, 2, 28, 28, 56 / 1.2);
        grad.addColorStop(0, 'rgba(0, 0, 0, 0)');
        grad.addColorStop(1, 'rgba(0, 0, 0, 0.45)');
        sCtx.fillStyle = grad;
        sCtx.fillRect(0, 0, 56, 56);
    }
    return cellShadowCanvas;
}

function triggerBackgroundRipple(x, y) {
    if (!backgroundCanvas) return;
    const originCol = x / rippleGrid.cellSize;
    const originRow = y / rippleGrid.cellSize;
    rippleGrid.ripples.push({
        col: originCol,
        row: originRow,
        startTime: performance.now(),
        maxDist: Math.hypot(rippleGrid.cols, rippleGrid.rows)
    });
    if (rippleGrid.ripples.length > 8) {
        rippleGrid.ripples.shift();
    }
}

function initBackgroundParticles() {
    backgroundCanvas = document.getElementById('particleBackground');
    if (!backgroundCanvas) return;
    
    backgroundCtx = backgroundCanvas.getContext('2d');
    if (!backgroundCtx) return;
    
    function resizeBackgroundCanvas() {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        backgroundCanvas.width = window.innerWidth * dpr;
        backgroundCanvas.height = window.innerHeight * dpr;
        backgroundCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        
        rippleGrid.cols = Math.ceil(window.innerWidth / rippleGrid.cellSize) + 1;
        rippleGrid.rows = Math.ceil(window.innerHeight / rippleGrid.cellSize) + 1;
    }
    
    resizeBackgroundCanvas();
    window.addEventListener('resize', debounce(resizeBackgroundCanvas, 200));

    // Initial ambient ripple on load (matches Aceternity demo preview)
    setTimeout(() => {
        triggerBackgroundRipple(window.innerWidth / 2, window.innerHeight * 0.35);
    }, 400);
}

function animateBackgroundParticles() {
    if (!backgroundCanvas || !backgroundCtx) return;
    
    // Check if we're in footer section and hide canvas if so (footer has its own celestial background)
    const footer = document.querySelector('.footer');
    if (footer) {
        const footerTop = footer.offsetTop;
        const footerBottom = footerTop + footer.offsetHeight;
        const scrollPosition = window.scrollY;
        const windowHeight = window.innerHeight;
        const windowMiddle = scrollPosition + (windowHeight / 2);
        
        if (windowMiddle >= footerTop && windowMiddle <= footerBottom) {
            backgroundCanvas.style.opacity = '0';
            backgroundCanvas.style.visibility = 'hidden';
            requestAnimationFrame(animateBackgroundParticles);
            return;
        } else {
            backgroundCanvas.style.opacity = '1';
            backgroundCanvas.style.visibility = 'visible';
        }
    }
    
    const now = performance.now();
    const width = window.innerWidth;
    const height = window.innerHeight;
    backgroundCtx.clearRect(0, 0, width, height);

    // Clean expired ripples: delay = dist * 55ms, duration = 200 + dist * 80ms
    rippleGrid.ripples = rippleGrid.ripples.filter(r => (now - r.startTime) < (r.maxDist * 55 + 600));

    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    const baseBorder = isLight ? 'rgba(0, 0, 0, 0.08)' : 'rgba(255, 255, 255, 0.07)';
    const activeBorder = isLight ? 'rgba(14, 165, 233, 0.55)' : 'rgba(14, 165, 233, 0.65)';
    const hoverBorder = isLight ? 'rgba(0, 0, 0, 0.25)' : 'rgba(255, 255, 255, 0.25)';
    const baseFill = isLight ? 'rgba(0, 0, 0, 0.015)' : 'rgba(255, 255, 255, 0.015)';

    const cx = width / 2;
    const cy = height * 0.2;
    const maxRadius = Math.hypot(width, height) * 0.65;
    const cellSize = rippleGrid.cellSize;
    const cols = rippleGrid.cols;
    const rows = rippleGrid.rows;
    const mouseCol = rippleGrid.mouseCol;
    const mouseRow = rippleGrid.mouseRow;
    const ripples = rippleGrid.ripples;
    const ripplesCount = ripples.length;
    const shadowCanvas = !isLight ? getCellShadowCanvas() : null;

    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const x = c * cellSize;
            const y = r * cellSize;

            // Radial mask attenuation (stronger near top-center, fading softly outward)
            const distFromCenter = Math.hypot(x + cellSize / 2 - cx, y + cellSize / 2 - cy);
            const maskAlpha = Math.max(0.12, Math.min(1, 1 - Math.pow(distFromCenter / maxRadius, 1.4)));

            const isHovered = (c === mouseCol && r === mouseRow);

            // Calculate ripple wave intensity
            let rippleIntensity = 0;
            if (ripplesCount > 0) {
                for (let i = 0; i < ripplesCount; i++) {
                    const rip = ripples[i];
                    const dist = Math.hypot(c - rip.col, r - rip.row);
                    const delay = dist * 55;
                    const duration = 200 + dist * 80;
                    const elapsed = now - rip.startTime;

                    if (elapsed >= delay && elapsed <= delay + duration) {
                        const progress = (elapsed - delay) / duration;
                        const wave = Math.sin(progress * Math.PI);
                        if (wave > rippleIntensity) {
                            rippleIntensity = wave;
                        }
                    }
                }
            }

            // Composite opacity
            const baseAlpha = 0.35 * maskAlpha;
            let cellAlpha = baseAlpha;
            if (rippleIntensity > 0) {
                cellAlpha = baseAlpha + (0.85 - baseAlpha) * rippleIntensity * maskAlpha;
            }
            if (isHovered) {
                cellAlpha = Math.max(cellAlpha, 0.85);
            }

            backgroundCtx.save();
            backgroundCtx.globalAlpha = cellAlpha;

            // Cell Fill
            if (rippleIntensity > 0) {
                backgroundCtx.fillStyle = isLight 
                    ? `rgba(14, 165, 233, ${0.12 * rippleIntensity})` 
                    : `rgba(14, 165, 233, ${0.18 * rippleIntensity})`;
                backgroundCtx.fillRect(x, y, cellSize, cellSize);
            } else if (isHovered) {
                backgroundCtx.fillStyle = isLight ? 'rgba(0, 0, 0, 0.04)' : 'rgba(255, 255, 255, 0.05)';
                backgroundCtx.fillRect(x, y, cellSize, cellSize);
            } else {
                backgroundCtx.fillStyle = baseFill;
                backgroundCtx.fillRect(x, y, cellSize, cellSize);
            }

            // Cell Border
            backgroundCtx.lineWidth = 0.5;
            if (isHovered) {
                backgroundCtx.strokeStyle = hoverBorder;
            } else if (rippleIntensity > 0.3) {
                backgroundCtx.strokeStyle = activeBorder;
            } else {
                backgroundCtx.strokeStyle = baseBorder;
            }
            backgroundCtx.strokeRect(x + 0.25, y + 0.25, cellSize - 0.5, cellSize - 0.5);

            // Inset dark shadow for 3D depth (matching Aceternity dark:shadow-inset)
            if (shadowCanvas) {
                backgroundCtx.drawImage(shadowCanvas, x, y);
            }

            backgroundCtx.restore();
        }
    }
    requestAnimationFrame(animateBackgroundParticles);
}

// Global Mouse & Touch tracking for background ripple interaction
if (typeof window !== 'undefined') {
    window.addEventListener('mousemove', function(e) {
        mousePos.x = e.clientX;
        mousePos.y = e.clientY;
        rippleGrid.mouseCol = Math.floor(e.clientX / rippleGrid.cellSize);
        rippleGrid.mouseRow = Math.floor(e.clientY / rippleGrid.cellSize);
    }, { passive: true });

    window.addEventListener('mouseleave', function() {
        mousePos.x = null;
        mousePos.y = null;
        rippleGrid.mouseCol = -1;
        rippleGrid.mouseRow = -1;
    });

    window.addEventListener('click', function(e) {
        triggerBackgroundRipple(e.clientX, e.clientY);
    });

    window.addEventListener('touchstart', function(e) {
        if (e.touches && e.touches.length > 0) {
            triggerBackgroundRipple(e.touches[0].clientX, e.touches[0].clientY);
        }
    }, { passive: true });
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
// Hero WebGL Fluid Distortion Shader (bold-answers-412382.framer.app)
// Iridescent chromatic fluid distortion waves on dark canvas
// ============================================================================
function initHeroShaderBg() {
    const container = document.getElementById('heroShaderBg') || document.getElementById('heroPrismGradient');
    const canvas = document.getElementById('heroShaderCanvas') || document.getElementById('heroPrismCanvas');
    if (!container || !canvas || container.dataset.shaderInitialized) return;
    container.dataset.shaderInitialized = 'true';

    const gl = canvas.getContext('webgl', { alpha: true, antialias: false, preserveDrawingBuffer: false }) ||
               canvas.getContext('experimental-webgl');
    if (!gl) return;

    const createShader = (type, source) => {
        const shader = gl.createShader(type);
        if (!shader) return null;
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            console.error(gl.getShaderInfoLog(shader));
            gl.deleteShader(shader);
            return null;
        }
        return shader;
    };

    const vertShader = createShader(gl.VERTEX_SHADER, `
        attribute vec2 position;
        void main() {
            gl_Position = vec4(position, 0.0, 1.0);
        }
    `);

    const fragShader = createShader(gl.FRAGMENT_SHADER, `
        precision highp float;
        uniform vec2 u_res;
        uniform float u_time;
        uniform float u_colorScale;
        uniform float u_frequency;
        uniform vec3 u_baseColor;

        vec2 distort(vec2 p, float offset) {
            p += offset;
            for(float i = 1.0; i < 4.0; i++) {
                p.x += 0.3 / i * sin(i * 3.0 * p.y + u_time);
                p.y += 0.3 / i * cos(i * 3.0 * p.x + u_time);
            }
            return p;
        }

        void main() {
            vec2 uv = gl_FragCoord.xy / u_res.xy;

            float r = sin(distort(uv, 0.0).x * u_frequency) * 0.5 + 0.5;
            float g = sin(distort(uv, 0.02).x * u_frequency) * 0.5 + 0.5;
            float b = sin(distort(uv, 0.04).x * u_frequency) * 0.5 + 0.5;

            vec3 color = pow(vec3(r, g, b), vec3(u_colorScale));
            vec3 finalColor = mix(u_baseColor, color, 0.8);

            gl_FragColor = vec4(finalColor, 1.0);
        }
    `);

    if (!vertShader || !fragShader) return;

    const program = gl.createProgram();
    if (!program) return;
    gl.attachShader(program, vertShader);
    gl.attachShader(program, fragShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        console.error(gl.getProgramInfoLog(program));
        return;
    }
    gl.useProgram(program);

    // Fullscreen quad geometry
    const quad = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);

    const posLoc = gl.getAttribLocation(program, 'position');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    const uniforms = {
        res: gl.getUniformLocation(program, 'u_res'),
        time: gl.getUniformLocation(program, 'u_time'),
        colorScale: gl.getUniformLocation(program, 'u_colorScale'),
        frequency: gl.getUniformLocation(program, 'u_frequency'),
        baseColor: gl.getUniformLocation(program, 'u_baseColor'),
    };

    const speed = 0.5;
    const colorScale = 8.0;
    const frequency = 5.0;
    let timeValue = 0;
    let animId = null;
    let isVisible = true;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function resize() {
        if (!canvas || !gl || !uniforms.res) return;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const w = container.clientWidth || window.innerWidth;
        const h = container.clientHeight || window.innerHeight;
        canvas.width = Math.floor(w * dpr);
        canvas.height = Math.floor(h * dpr);
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.uniform2f(uniforms.res, canvas.width, canvas.height);
    }

    function render() {
        if (!isVisible) {
            animId = null;
            return;
        }
        if (!reduceMotion) {
            timeValue += speed * 0.015;
        }
        const isLight = document.documentElement.getAttribute('data-theme') === 'light';
        const baseColor = isLight ? [0.96, 0.96, 0.98] : [0.0196, 0.0196, 0.0196];

        gl.uniform1f(uniforms.time, timeValue);
        gl.uniform1f(uniforms.colorScale, colorScale);
        gl.uniform1f(uniforms.frequency, frequency);
        gl.uniform3f(uniforms.baseColor, baseColor[0], baseColor[1], baseColor[2]);
        gl.drawArrays(gl.TRIANGLES, 0, 6);

        if (!reduceMotion) {
            animId = requestAnimationFrame(render);
        }
    }

    resize();
    window.addEventListener('resize', resize, { passive: true });
    render();

    if ('IntersectionObserver' in window) {
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                isVisible = entry.isIntersecting;
                if (isVisible && !animId && !reduceMotion) {
                    animId = requestAnimationFrame(render);
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
                    if (typeof animateProgressBar === 'function' && percentage) {
                        animateProgressBar(progressFill, percentage);
                    }
                }
            });
        }, { threshold: 0.2 });
        
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
    
    // Mount Framer Liquid Metal Shader (IconWebglShader)
    const shaderContainer = document.getElementById('scrollToTopShader');
    if (shaderContainer) {
        import('https://esm.sh/@paper-design/shaders@0.0.81')
            .then(({ ShaderMount, liquidMetalFragmentShader }) => {
                new ShaderMount(shaderContainer, liquidMetalFragmentShader, {
                    u_repetition: 1.6,
                    u_softness: 0.45,
                    u_scale: 1.6,
                    u_angle: 120,
                    u_shiftRed: 0.35,
                    u_shiftBlue: 0.35,
                    u_distortion: 0,
                    u_contour: 0,
                    u_shape: 1,
                    u_offsetX: 0.1,
                    u_offsetY: -0.1
                }, undefined, 1);
            })
            .catch(err => {
                console.warn('IconWebglShader WebGL fallback active:', err);
            });
    }

    // Show/hide button based on scroll position
    window.addEventListener('scroll', () => {
        if (window.pageYOffset > 300) {
            scrollToTopBtn.classList.add('show');
        } else {
            scrollToTopBtn.classList.remove('show');
        }
    }, { passive: true });
    
    // Smooth scroll to top when button is clicked
    scrollToTopBtn.addEventListener('click', () => {
        window.scrollTo({
            top: 0,
            behavior: 'smooth'
        });
    });
}

function initProfileImageTransition() {}

// Framer Scroll Sections (https://scrollsections.framer.ai)
function initPillScrollBar() {
    const container = document.getElementById('pillScrollBar');
    if (!container) return;

    const sections = [
        { id: 'home', name: 'Home' },
        { id: 'about', name: 'About' },
        { id: 'experience', name: 'Experience' },
        { id: 'education', name: 'Education' },
        { id: 'skills', name: 'Skills' },
        { id: 'projects', name: 'Projects' },
        { id: 'portfolio', name: 'Portfolio' },
        { id: 'contact', name: 'Contact' }
    ].map(s => ({ ...s, el: document.getElementById(s.id) })).filter(s => s.el);

    if (!sections.length) return;

    let bars = container.querySelectorAll('.scroll-section-bar');
    if (bars.length !== sections.length) {
        container.innerHTML = sections.map(s =>
            `<div class="scroll-section-bar" data-section="${s.id}" title="${s.name}"><div class="scroll-section-fill"></div></div>`
        ).join('');
        bars = container.querySelectorAll('.scroll-section-bar');
    }

    const fills = container.querySelectorAll('.scroll-section-fill');
    let ticking = false;

    function update() {
        const scrollY = window.pageYOffset || document.documentElement.scrollTop;
        const winHeight = window.innerHeight;
        const docHeight = Math.max(
            document.body.scrollHeight, document.documentElement.scrollHeight,
            document.body.offsetHeight, document.documentElement.offsetHeight
        );
        const isBottom = (scrollY + winHeight >= docHeight - 15);

        let activeIdx = 0;

        sections.forEach((sec, idx) => {
            const rect = sec.el.getBoundingClientRect();
            const top = scrollY + rect.top;
            const height = rect.height;
            const bottom = top + height;

            let progress = 0;
            if (scrollY < top) {
                progress = 0;
            } else if (scrollY >= bottom) {
                progress = 1;
            } else {
                const s = (scrollY - top) / (height || 1);
                const c = s < 0.15 ? s + (0.15 - s) * 0.45 : s;
                progress = Math.max(0, Math.min(1, c));
            }

            if (scrollY >= top && scrollY < bottom) {
                activeIdx = idx;
            } else if (scrollY >= bottom) {
                activeIdx = idx;
            }

            if (fills[idx]) {
                fills[idx].style.height = `${progress * 100}%`;
            }
        });

        if (isBottom) {
            activeIdx = sections.length - 1;
            if (fills[activeIdx]) {
                fills[activeIdx].style.height = '100%';
            }
        }

        bars.forEach((bar, idx) => {
            bar.classList.toggle('active', idx === activeIdx);
        });
        ticking = false;
    }

    function onScroll() {
        if (!ticking) {
            requestAnimationFrame(update);
            ticking = true;
        }
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    update();

    bars.forEach((bar, idx) => {
        bar.addEventListener('click', () => {
            const sec = sections[idx];
            if (!sec || !sec.el) return;
            if (sec.id === 'home') {
                window.scrollTo({ top: 0, behavior: 'smooth' });
            } else {
                const navbar = document.getElementById('navbar');
                const navHeight = navbar ? navbar.offsetHeight : 70;
                const top = sec.el.getBoundingClientRect().top + window.pageYOffset - navHeight;
                window.scrollTo({ top, behavior: 'smooth' });
            }
        });
    });
}

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
  const fill = window.innerWidth <= 768 ? 0.70 : 0.50;

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
    const bottomPad = 12;
    const sidePad = 10;
    let deepest = null;
    const add = (c) => {
      c.correct = false;
      if (!deepest || c.depth > deepest.depth) {
        deepest = c;
      }
      out.push(c);
    };
    for (const [x, y] of ends(body)) {
      if (y + body.r - (height - bottomPad) > -0.5) {
        add(contact(body, null, 0, -1, x, height - bottomPad, y + body.r - (height - bottomPad)));
      }
      if (body.r + sidePad - x > -0.5) {
        add(contact(body, null, 1, 0, sidePad, y, body.r + sidePad - x));
      }
      if (x + body.r - (width - sidePad) > -0.5) {
        add(contact(body, null, -1, 0, width - sidePad, y, x + body.r - (width - sidePad)));
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

  const scatter = (n) => { const x = Math.sin(n * 12.9898) * 43758.5453; return x - Math.floor(x); };

  function createBodies(els, width, height, fillRatio) {
    const bodies = [];
    let area = 0;
    const PHI = 0.618033988749895;
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
      const minX = w / 2 + 24;
      const maxX = Math.max(minX, width - w / 2 - 24);
      const span = Math.max(maxX - minX, 1);
      const ratio = (index * PHI) % 1.0;
      const spawnX = minX + span * ratio;
      bodies.push({
        x: spawnX,
        y: -h - index * 52,
        a: (scatter(index + 7) - 0.5) * 0.8,
        vx: (scatter(index + 3) - 0.5) * 120,
        vy: 0,
        w: (scatter(index + 5) - 0.5) * 1.5,
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

  let visibilityInterval = null;
  const begin = () => {
    if (started) return;
    world.width = layer.clientWidth;
    world.height = layer.clientHeight;
    if (world.width === 0 || world.height === 0) return;
    started = true;
    if (visibilityInterval) {
      clearInterval(visibilityInterval);
      visibilityInterval = null;
    }
    world.bodies = createBodies(elements, world.width, world.height, fill);
    if (reduceMotion || document.hidden) {
      let steps = 0;
      while (steps < 2400 && !step(world)) {
        steps++;
      }
      render(world.bodies);
      if (reduceMotion) return;
    }
    render(world.bodies);
    wake();
  };

  function checkVisibility() {
    const rect = footer.getBoundingClientRect();
    if (rect.top < (window.innerHeight || document.documentElement.clientHeight) + 100 && rect.bottom > 0) {
      visible = true;
      begin();
      wake();
    }
  }

  const intersection = new IntersectionObserver(([entry]) => {
    if (entry && entry.isIntersecting) {
      visible = true;
      begin();
      wake();
    } else {
      visible = false;
    }
  }, { threshold: 0.05 });
  intersection.observe(footer);

  window.addEventListener('scroll', checkVisibility, { passive: true });
  visibilityInterval = setInterval(checkVisibility, 250);
  checkVisibility();

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && started) {
      visible = true;
      wake();
    }
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

// AnimatedSVGUnderlink: Framer style for Footer "Robin Hossain"
// https://framer.com/m/AnimatedSVGUnderlink-3znx.js@ft7WMbqy3v8eCTzx4jMM
function initFooterAnimatedUnderlink() {
    const link = document.querySelector('.footer .developer-link');
    if (!link || link.dataset.underlinkInit) return;
    link.dataset.underlinkInit = 'true';

    let path = link.querySelector('.underlink-path');
    if (!path) {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('class', 'underlink-svg');
        svg.setAttribute('viewBox', '0 0 310 40');
        svg.setAttribute('preserveAspectRatio', 'none');
        svg.setAttribute('aria-hidden', 'true');
        path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('class', 'underlink-path');
        path.setAttribute('fill', 'none');
        svg.appendChild(path);
        link.appendChild(svg);
    }

    const svgVariants = [
        "M5 20.9999C26.7762 16.2245 49.5532 11.5572 71.7979 14.6666C84.9553 16.5057 97.0392 21.8432 109.987 24.3888C116.413 25.6523 123.012 25.5143 129.042 22.6388C135.981 19.3303 142.586 15.1422 150.092 13.3333C156.799 11.7168 161.702 14.6225 167.887 16.8333C181.562 21.7212 194.975 22.6234 209.252 21.3888C224.678 20.0548 239.912 17.991 255.42 18.3055C272.027 18.6422 288.409 18.867 305 17.9999",
        "M5 24.2592C26.233 20.2879 47.7083 16.9968 69.135 13.8421C98.0469 9.5853 128.407 4.02322 158.059 5.14674C172.583 5.69708 187.686 8.66104 201.598 11.9696C207.232 13.3093 215.437 14.9471 220.137 18.3619C224.401 21.4596 220.737 25.6575 217.184 27.6168C208.309 32.5097 197.199 34.281 186.698 34.8486C183.159 35.0399 147.197 36.2657 155.105 26.5837C158.11 22.9053 162.993 20.6229 167.764 18.7924C178.386 14.7164 190.115 12.1115 201.624 10.3984C218.367 7.90626 235.528 7.06127 252.521 7.49276C258.455 7.64343 264.389 7.92791 270.295 8.41825C280.321 9.25056 296 10.8932 305 13.0242",
        "M5 29.5014C9.61174 24.4515 12.9521 17.9873 20.9532 17.5292C23.7742 17.3676 27.0987 17.7897 29.6575 19.0014C33.2644 20.7093 35.6481 24.0004 39.4178 25.5014C48.3911 29.0744 55.7503 25.7731 63.3048 21.0292C67.9902 18.0869 73.7668 16.1366 79.3721 17.8903C85.1682 19.7036 88.2173 26.2464 94.4121 27.2514C102.584 28.5771 107.023 25.5064 113.276 20.6125C119.927 15.4067 128.83 12.3333 137.249 15.0014C141.418 16.3225 143.116 18.7528 146.581 21.0014C149.621 22.9736 152.78 23.6197 156.284 24.2514C165.142 25.8479 172.315 17.5185 179.144 13.5014C184.459 10.3746 191.785 8.74853 195.868 14.5292C199.252 19.3205 205.597 22.9057 211.621 22.5014C215.553 22.2374 220.183 17.8356 222.979 15.5569C225.4 13.5845 227.457 11.1105 230.742 10.5292C232.718 10.1794 234.784 12.9691 236.164 14.0014C238.543 15.7801 240.717 18.4775 243.356 19.8903C249.488 23.1729 255.706 21.2551 261.079 18.0014C266.571 14.6754 270.439 11.5202 277.146 13.6125C280.725 14.7289 283.221 17.209 286.393 19.0014C292.321 22.3517 298.255 22.5014 305 22.5014",
        "M17.0039 32.6826C32.2307 32.8412 47.4552 32.8277 62.676 32.8118C67.3044 32.807 96.546 33.0555 104.728 32.0775C113.615 31.0152 104.516 28.3028 102.022 27.2826C89.9573 22.3465 77.3751 19.0254 65.0451 15.0552C57.8987 12.7542 37.2813 8.49399 44.2314 6.10216C50.9667 3.78422 64.2873 5.81914 70.4249 5.96641C105.866 6.81677 141.306 7.58809 176.75 8.59886C217.874 9.77162 258.906 11.0553 300 14.4892",
        "M4.99805 20.9998C65.6267 17.4649 126.268 13.845 187.208 12.8887C226.483 12.2723 265.751 13.2796 304.998 13.9998",
        "M5 29.8857C52.3147 26.9322 99.4329 21.6611 146.503 17.1765C151.753 16.6763 157.115 15.9505 162.415 15.6551C163.28 15.6069 165.074 15.4123 164.383 16.4275C161.704 20.3627 157.134 23.7551 153.95 27.4983C153.209 28.3702 148.194 33.4751 150.669 34.6605C153.638 36.0819 163.621 32.6063 165.039 32.2029C178.55 28.3608 191.49 23.5968 204.869 19.5404C231.903 11.3436 259.347 5.83254 288.793 5.12258C294.094 4.99476 299.722 4.82265 305 5.45025"
    ];

    let nextIndex = Math.floor(Math.random() * svgVariants.length);
    let currentLength = 310;
    let isHovered = false;

    path.setAttribute('d', svgVariants[nextIndex]);

    function onEnter() {
        isHovered = true;
        const currentVariant = svgVariants[nextIndex];
        nextIndex = (nextIndex + 1) % svgVariants.length;

        path.setAttribute('d', currentVariant);
        const len = path.getTotalLength() || 310;
        currentLength = len;

        const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        path.style.transition = 'none';
        path.style.opacity = '1';
        path.style.strokeDasharray = `${len} ${len}`;
        path.style.strokeDashoffset = len;
        path.getBoundingClientRect();

        if (prefersReducedMotion) {
            path.style.strokeDashoffset = '0';
        } else {
            path.style.transition = 'stroke-dashoffset 0.6s cubic-bezier(0.4, 0, 0.2, 1)';
            path.style.strokeDashoffset = '0';
        }
    }

    function onLeave() {
        if (!isHovered) return;
        isHovered = false;

        const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (prefersReducedMotion) {
            path.style.opacity = '0';
            return;
        }

        path.style.transition = 'stroke-dashoffset 0.45s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.45s ease';
        path.style.strokeDashoffset = -currentLength;
        path.style.opacity = '0';
    }

    link.addEventListener('mouseenter', onEnter);
    link.addEventListener('mouseleave', onLeave);
    link.addEventListener('focus', onEnter);
    link.addEventListener('blur', onLeave);
}
initFooterAnimatedUnderlink();

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

// Framer Progress Card Animation (Technical Skills & Language Proficiency)
function initProgressBars() {
    const progressBars = document.querySelectorAll('.progress-fill[data-percentage]');
    
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const progressFill = entry.target;
                const percentage = progressFill.getAttribute('data-percentage');
                
                // Animate progress bar fill and metric marker in synchronization
                animateProgressBar(progressFill, percentage);
                
                // Unobserve after animation to prevent re-triggering
                observer.unobserve(entry.target);
            }
        });
    }, { threshold: 0.2 });
    
    progressBars.forEach(bar => observer.observe(bar));
}

function animateProgressBar(progressFill, targetPercentage) {
    const progressBar = progressFill.closest('.progress-bar');
    const marker = progressBar ? progressBar.querySelector('.progress-marker') : null;
    const pct = parseFloat(targetPercentage) || 0;
    
    requestAnimationFrame(() => {
        progressFill.style.setProperty('--target-width', `${pct}%`);
        progressFill.style.width = `${pct}%`;
        if (marker) {
            marker.style.left = `${pct}%`;
            marker.classList.add('animate');
        }
        progressFill.classList.add('animate');
    });
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


    /* ==========================================================================
       DRIFT TIMELINE CONTROLLER - EXACT FRAMER REPLICATION (https://drift-timeline.framer.website/)
       ========================================================================== */
    function initDriftTimeline() {
        const wrap = document.getElementById('driftTimelineWrap');
        const viewport = document.getElementById('driftTimelineViewport');
        const track = document.getElementById('driftTimelineTrack');
        const prevBtn = document.getElementById('driftPrevBtn');
        const nextBtn = document.getElementById('driftNextBtn');
        if (!wrap || !viewport || !track) return;
        if (wrap.dataset.driftInit) return;
        wrap.dataset.driftInit = 'true';

        const slides = Array.from(track.querySelectorAll('.drift-timeline-slide'));
        const count = slides.length;
        if (count === 0) return;

        // Configuration matching Framer Drift Timeline exactly
        const BASE_CARD_WIDTH = 348; // Framer cardWidth: 348
        const GAP = 72;              // Framer gap: 72
        const STAGGER = 65;          // Framer stagger: 65ms
        const MOMENTUM = 0.3;        // Framer momentum: 0.3
        const OVERSHOOT = 0.4;       // Framer overshoot: 0.4
        const DRAG_SPEED = 1.5;      // Framer dragSpeed: 1.5
        const RETURN_DURATION = 1.27;// Framer lt = 1.27s

        // Framer spring lookup table for return phase settle (ct)
        const ct = [
            0, 0, 0.003, 0.006, 0.014, 0.024, 0.04, 0.057, 0.079, 0.107,
            0.141, 0.183, 0.234, 0.295, 0.369, 0.461, 0.577, 0.716, 0.861, 0.974,
            1.038, 1.083, 1.107, 1.115, 1.115, 1.107, 1.095, 1.08, 1.065, 1.049,
            1.038, 1.028, 1.018, 1.012, 1.008, 1.003, 1.002, 1, 1
        ];

        // Spring table interpolator (ut)
        function springEase(t) {
            const clamped = Math.min(Math.max(t, 0), 1) * (ct.length - 1);
            const n = Math.floor(clamped);
            const r = clamped - n;
            const i = ct[n];
            return i + (ct[Math.min(n + 1, ct.length - 1)] - i) * r;
        }

        // Cubic bezier solver for dt = [.39, .03, .16, .99]
        function solveBezier(p1x, p1y, p2x, p2y) {
            return function(t) {
                if (t <= 0) return 0;
                if (t >= 1) return 1;
                let s = t;
                for (let i = 0; i < 8; i++) {
                    const x = 3 * (1 - s) * (1 - s) * s * p1x + 3 * (1 - s) * s * s * p2x + s * s * s;
                    const dx = 3 * (1 - s) * (1 - s) * p1x + 6 * (1 - s) * s * (p2x - p1x) + 3 * s * s * (1 - p2x);
                    if (Math.abs(x - t) < 1e-5 || Math.abs(dx) < 1e-5) break;
                    s -= (x - t) / dx;
                }
                return 3 * (1 - s) * (1 - s) * s * p1y + 3 * (1 - s) * s * s * p2y + s * s * s;
            };
        }

        const glideEase = solveBezier(0.39, 0.03, 0.16, 0.99);

        function ft(e) {
            const t = 1 - Math.exp(-e);
            return n => (1 - Math.exp(-e * n)) / t;
        }

        function mt(e) {
            const t = e - 2, n = 3 - 2 * e;
            return r => ((t * r + n) * r + e) * r;
        }

        // Dynamic State variables
        let cardWidth = BASE_CARD_WIDTH;
        let gap = GAP;
        let stepDist = cardWidth + gap; // V
        let maxBound = Math.max(0, (count - 1) * stepDist); // He

        let currentX = 0; // R.current
        let activeIndex = 0; // z.current
        let refIndex = 0; // Ce.current - departed index for wave stagger
        let animState = 'idle'; // B.current: 'idle', 'drag', 'glide', 'return'
        let isSettled = true; // Se.current
        let lastActiveTime = 0; // xe.current
        let rafId = 0; // be.current

        const history = []; // ye.current: [{ t, x }]
        const renderedPositions = new Array(count).fill(null); // ve.current
        let activeAnimation = null; // we.current
        let preventClick = false; // Te.current

        const dragState = {
            active: false,
            moved: false,
            interrupted: false,
            startX: 0,
            startTrack: 0,
            pointerId: 0,
            scale: 1
        };

        const wheelState = {
            active: false,
            locked: false,
            raw: 0,
            lastT: 0,
            lastAbs: 0,
            peak: 0,
            falling: 0,
            timer: null
        };

        function updateGeometry() {
            const viewportWidth = viewport.clientWidth || window.innerWidth;
            cardWidth = Math.min(BASE_CARD_WIDTH, Math.max(240, viewportWidth - 48));
            gap = viewportWidth <= 768 ? 32 : GAP;
            stepDist = cardWidth + gap;
            maxBound = Math.max(0, (count - 1) * stepDist);

            // Center active slide: padding = calc(50% - cardWidth/2)
            track.style.paddingLeft = `calc(50% - ${cardWidth / 2}px)`;
            track.style.paddingRight = `calc(50% - ${cardWidth / 2}px)`;
            track.style.gap = `${gap}px`;

            slides.forEach(s => {
                s.style.width = `${cardWidth}px`;
                s.style.flex = `0 0 ${cardWidth}px`;
            });
        }

        // Rubberband constraint (Ue)
        function constrainBounds(x) {
            if (x < 0) return x * 0.35;
            if (x > maxBound) return maxBound + (x - maxBound) * 0.35;
            return x;
        }

        // Position history interpolator (Ye)
        function interpolateHistory(sampleTime) {
            if (history.length === 0) return currentX;
            if (sampleTime <= history[0].t) return history[0].x;
            for (let n = history.length - 1; n >= 0; n--) {
                if (history[n].t <= sampleTime) {
                    const r = history[n], i = history[n + 1];
                    if (!i) return r.x;
                    const a = (sampleTime - r.t) / Math.max(1, i.t - r.t);
                    return r.x + (i.x - r.x) * a;
                }
            }
            return history[history.length - 1].x;
        }

        // Velocity calculator (Xe)
        function calculateVelocity() {
            if (history.length < 2) return 0;
            const now = performance.now();
            const last = history[history.length - 1];
            if (now - last.t > 80) return 0;
            const r = Math.max(history[0].t, last.t - 80);
            const dt = last.t - r;
            return dt < 8 ? 0 : (last.x - interpolateHistory(r)) / dt * 1000;
        }

        // W(now): Apply staggered drift translation to all slides
        function updateSlideTransforms(now) {
            const targetX = currentX;
            while (history.length > 0 && now - history[0].t > 1500) {
                history.shift();
            }
            history.push({ t: now, x: targetX });

            let maxDiff = 0;

            for (let n = 0; n < count; n++) {
                // Stagger lag formula: clamp(n - refIndex + 1, 0, 8) * STAGGER
                const s = Math.min(Math.max(n - refIndex + 1, 0), 8) * STAGGER;
                const sampledX = s > 0 ? interpolateHistory(now - s) : targetX;
                const diff = Math.abs(sampledX - targetX);
                if (diff > maxDiff) maxDiff = diff;

                if (renderedPositions[n] !== sampledX) {
                    renderedPositions[n] = sampledX;
                    const slide = slides[n];
                    if (slide) {
                        slide.style.transform = `translate3d(${-sampledX.toFixed(2)}px, 0, 0)`;
                    }
                }
            }
            return maxDiff;
        }

        // RAF Loop (Ze & G)
        function rafTick() {
            rafId = 0;
            const now = performance.now();
            const maxDiff = updateSlideTransforms(now);
            if (animState === 'idle' && maxDiff < 0.02 && now - lastActiveTime > 350) {
                isSettled = true;
                return;
            }
            rafId = requestAnimationFrame(rafTick);
        }

        function wakeRAF() {
            isSettled = false;
            lastActiveTime = performance.now();
            if (!rafId) {
                rafId = requestAnimationFrame(rafTick);
            }
        }

        function setTrackPosition(x) {
            currentX = x;
            const now = performance.now();
            lastActiveTime = now;
            updateSlideTransforms(now);
            wakeRAF();
        }

        function stopAnimation() {
            if (activeAnimation) {
                activeAnimation.stop();
                activeAnimation = null;
            }
        }

        function setActiveSlide(newIdx) {
            activeIndex = Math.min(Math.max(newIdx, 0), count - 1);
            slides.forEach((s, i) => {
                const isActive = (i === activeIndex);
                s.classList.toggle('active', isActive);
                s.setAttribute('aria-current', isActive ? 'true' : 'false');
            });

            if (prevBtn) prevBtn.disabled = (activeIndex <= 0);
            if (nextBtn) nextBtn.disabled = (activeIndex >= count - 1);
        }

        function animateValue(from, to, options) {
            const startTime = performance.now();
            const durationMs = (options.duration || 1) * 1000;
            const ease = options.ease || (t => t);
            let stopped = false;
            let localRaf = 0;

            function step(now) {
                if (stopped) return;
                const elapsed = now - startTime;
                const progress = Math.min(Math.max(elapsed / durationMs, 0), 1);
                const eased = ease(progress);
                const val = from + (to - from) * eased;
                if (options.onUpdate) options.onUpdate(val);

                if (progress >= 1) {
                    if (options.onComplete) options.onComplete();
                } else {
                    localRaf = requestAnimationFrame(step);
                }
            }

            localRaf = requestAnimationFrame(step);
            return {
                stop() {
                    stopped = true;
                    cancelAnimationFrame(localRaf);
                }
            };
        }

        // J(velocity, targetIndex): Two-phase Framer spring glide and return settle
        function jumpTo(velocity, target) {
            if (count === 0) return;
            stopAnimation();

            const n = currentX;
            const r = Math.max(0.05, MOMENTUM);
            const i = OVERSHOOT * stepDist;
            const isTargetSpecified = (target !== undefined);

            let o, s;
            if (isTargetSpecified) {
                o = Math.min(Math.max(target, 0), count - 1);
                s = Math.sign(o * stepDist - n) || 1;
            } else {
                const projected = n + velocity * r;
                o = Math.min(Math.max(Math.round(projected / stepDist), 0), count - 1);
                s = Math.abs(velocity) > 40 ? Math.sign(velocity) : (Math.sign(o * stepDist - n) || 1);
            }

            const c = o * stepDist;
            const l = Math.abs(velocity);
            const u = l * r;
            const d = (c - n) * s;
            let f;

            if (!isTargetSpecified && l < 80) {
                f = n;
            } else if (d > 0.5) {
                const e = d + (isTargetSpecified ? stepDist : u);
                f = c + s * Math.min(Math.max(i * Math.min(1, e / stepDist), Math.min(0.08 * stepDist, i)), i);
            } else {
                const e = Math.max(0, i - Math.abs(c - n));
                f = n + s * Math.min(u, e);
            }

            wakeRAF();

            const onCompleteAll = () => {
                activeAnimation = null;
                animState = 'idle';
                setActiveSlide(o);
                wakeRAF();
            };

            const returnPhase = () => {
                animState = 'return';
                setActiveSlide(o);
                const current = currentX;
                if (Math.abs(current - c) < 0.5) {
                    setTrackPosition(c);
                    onCompleteAll();
                    return;
                }
                activeAnimation = animateValue(current, c, {
                    duration: RETURN_DURATION,
                    ease: springEase,
                    onUpdate: setTrackPosition,
                    onComplete: onCompleteAll
                });
            };

            const dist = Math.abs(f - n);
            if (dist < 0.5) {
                returnPhase();
                return;
            }

            animState = 'glide';
            let duration, easeFunc;
            if (isTargetSpecified) {
                duration = Math.min(Math.max(0.85 + 0.25 * dist / stepDist, 1.1), 1.6);
                easeFunc = glideEase;
            } else if (l * 1.2 / dist <= 3) {
                duration = 1.2;
                easeFunc = mt(l * 1.2 / dist);
            } else if (u > dist * 1.02) {
                duration = Math.min(Math.max(-r * Math.log(1 - dist / u), 0.3), 1.8);
                easeFunc = ft(duration / r);
            } else {
                duration = Math.min(Math.max(3 * dist / l, 0.3), 1.2);
                easeFunc = mt(3);
            }

            activeAnimation = animateValue(n, f, {
                duration: duration,
                ease: easeFunc,
                onUpdate: setTrackPosition,
                onComplete: returnPhase
            });
        }

        function resetTo(index) {
            stopAnimation();
            animState = 'idle';
            if (wheelState.timer) clearTimeout(wheelState.timer);
            wheelState.active = false;
            wheelState.locked = false;
            dragState.active = false;
            history.length = 0;
            renderedPositions.fill(null);
            refIndex = index;
            currentX = index * stepDist;
            setActiveSlide(index);
            updateSlideTransforms(performance.now());
        }

        // Pointer event listeners (drag and swipe)
        viewport.addEventListener('pointerdown', (e) => {
            const isMouse = (e.pointerType === 'mouse');
            if (isMouse && e.button !== 0) return;
            const wasRunning = (animState !== 'idle');
            stopAnimation();
            animState = 'idle';

            dragState.active = true;
            dragState.moved = false;
            dragState.interrupted = wasRunning;
            dragState.startX = e.clientX;
            dragState.startTrack = currentX;
            dragState.pointerId = e.pointerId;
            dragState.scale = isMouse ? Math.max(0.2, DRAG_SPEED) : 1;

            if (isMouse) {
                e.preventDefault();
                viewport.focus({ preventScroll: true });
            }
        });

        window.addEventListener('pointermove', (e) => {
            if (!dragState.active) return;
            const dx = e.clientX - dragState.startX;
            if (!dragState.moved) {
                if (Math.abs(dx) < 4) return;
                dragState.moved = true;
                try { viewport.setPointerCapture(dragState.pointerId); } catch (err) {}
                refIndex = activeIndex;
                animState = 'drag';
                wakeRAF();
                viewport.classList.add('is-dragging');
            }
            setTrackPosition(constrainBounds(dragState.startTrack - dx * dragState.scale));
            e.preventDefault();
        });

        const onPointerUp = (e) => {
            if (!dragState.active) return;
            dragState.active = false;
            viewport.classList.remove('is-dragging');
            try { viewport.releasePointerCapture(e.pointerId); } catch (err) {}

            if (!dragState.moved) {
                if (dragState.interrupted) jumpTo(0);
                return;
            }

            preventClick = true;
            setTimeout(() => { preventClick = false; }, 60);
            const velocity = Math.min(Math.max(calculateVelocity(), -8000), 8000);
            jumpTo(velocity);
        };

        window.addEventListener('pointerup', onPointerUp);
        window.addEventListener('pointercancel', onPointerUp);

        // Mouse wheel / trackpad horizontal scrolling
        viewport.addEventListener('wheel', (e) => {
            if (!wheelState.active && Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
            if (!wheelState.active && Math.abs(e.deltaX) < 1) return;

            const delta = e.deltaX * (e.deltaMode === 1 ? 16 : 1);
            e.preventDefault();

            if (!wheelState.active) {
                wheelState.active = true;
                wheelState.raw = currentX;
                refIndex = activeIndex;
                animState = 'drag';
                wakeRAF();
            }

            wheelState.raw += delta;
            setTrackPosition(constrainBounds(wheelState.raw));

            clearTimeout(wheelState.timer);
            wheelState.timer = setTimeout(() => {
                wheelState.active = false;
                const velocity = Math.min(Math.max(calculateVelocity(), -8000), 8000);
                jumpTo(velocity);
            }, 90);
        }, { passive: false });

        // Slide click selection
        slides.forEach((slide, i) => {
            slide.addEventListener('click', (e) => {
                if (preventClick) {
                    e.preventDefault();
                    e.stopPropagation();
                    return;
                }
                if (e.target.closest('a')) return;
                if (i !== activeIndex) {
                    if (isSettled) refIndex = activeIndex;
                    jumpTo(0, i);
                }
            });
        });

        // Navigation buttons
        if (prevBtn) {
            prevBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (activeIndex > 0) {
                    if (isSettled) refIndex = activeIndex;
                    jumpTo(0, activeIndex - 1);
                }
            });
        }

        if (nextBtn) {
            nextBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (activeIndex < count - 1) {
                    if (isSettled) refIndex = activeIndex;
                    jumpTo(0, activeIndex + 1);
                }
            });
        }

        // Keyboard navigation
        viewport.addEventListener('keydown', (e) => {
            switch (e.key) {
                case 'ArrowRight':
                    e.preventDefault();
                    if (activeIndex < count - 1) {
                        if (isSettled) refIndex = activeIndex;
                        jumpTo(0, activeIndex + 1);
                    }
                    break;
                case 'ArrowLeft':
                    e.preventDefault();
                    if (activeIndex > 0) {
                        if (isSettled) refIndex = activeIndex;
                        jumpTo(0, activeIndex - 1);
                    }
                    break;
                case 'Home':
                    e.preventDefault();
                    if (isSettled) refIndex = activeIndex;
                    jumpTo(0, 0);
                    break;
                case 'End':
                    e.preventDefault();
                    if (isSettled) refIndex = activeIndex;
                    jumpTo(0, count - 1);
                    break;
            }
        });

        // Resize handling
        window.addEventListener('resize', () => {
            updateGeometry();
            resetTo(activeIndex);
        }, { passive: true });

        // Initial setup
        updateGeometry();
        resetTo(0);
    }

    /* ==========================================================================
       CERTIFICATIONS TESTIMONIAL CHAIN CONTROLLER (https://testimonialchain.framer.website)
       ========================================================================== */
    function initCertificationsChain() {
        const wrap = document.getElementById('certChainWrap');
        if (!wrap) return;

        // If already initialized, safely resume or reset autoplay
        if (wrap.dataset.initialized === 'true') {
            if (typeof wrap._resetAutoplay === 'function') {
                wrap._resetAutoplay();
            }
            return;
        }
        wrap.dataset.initialized = 'true';

        const stage = document.getElementById('certChainStage');
        const cards = Array.from(wrap.querySelectorAll('.cert-chain-card'));
        const pagers = Array.from(wrap.querySelectorAll('.cert-chain-pip'));
        const prevBtn = document.getElementById('certChainPrev');
        const nextBtn = document.getElementById('certChainNext');
        const total = cards.length;

        if (total === 0) return;

        let currentIndex = 0;
        let isPaused = false;
        let autoplayRaf = null;
        let autoplayStartTime = null;
        const AUTOPLAY_DURATION = 5000; // 5 seconds interval (Framer default)

        function setSlide(newIndex) {
            currentIndex = ((newIndex % total) + total) % total;

            cards.forEach((card, i) => {
                let diff = i - currentIndex;
                if (diff > total / 2) diff -= total;
                if (diff < -total / 2) diff += total;

                card.classList.remove('is-active');

                if (diff === 0) {
                    card.setAttribute('data-state', 'active');
                    card.classList.add('is-active');
                    card.setAttribute('aria-hidden', 'false');
                } else if (diff === 1) {
                    card.setAttribute('data-state', 'right-1');
                    card.setAttribute('aria-hidden', 'true');
                } else if (diff === 2) {
                    card.setAttribute('data-state', 'right-2');
                    card.setAttribute('aria-hidden', 'true');
                } else if (diff === -1) {
                    card.setAttribute('data-state', 'left-1');
                    card.setAttribute('aria-hidden', 'true');
                } else if (diff === -2) {
                    card.setAttribute('data-state', 'left-2');
                    card.setAttribute('aria-hidden', 'true');
                } else {
                    card.setAttribute('data-state', 'hidden');
                    card.setAttribute('aria-hidden', 'true');
                }
            });

            // Update pagers
            pagers.forEach((pip, i) => {
                const isActive = i === currentIndex;
                pip.classList.toggle('active', isActive);
                pip.setAttribute('aria-selected', isActive ? 'true' : 'false');
                const fill = pip.querySelector('.cert-chain-pip-fill');
                if (fill) {
                    fill.style.transform = 'scaleX(0)';
                }
            });

            startAutoplay();
        }

        function startAutoplay() {
            if (autoplayRaf) {
                cancelAnimationFrame(autoplayRaf);
                autoplayRaf = null;
            }
            if (isPaused) return;

            const activePip = pagers[currentIndex];
            const activeFill = activePip ? activePip.querySelector('.cert-chain-pip-fill') : null;
            autoplayStartTime = performance.now();

            function tick(now) {
                if (isPaused) return;
                const elapsed = now - autoplayStartTime;
                const progress = Math.min(1, elapsed / AUTOPLAY_DURATION);
                if (activeFill) {
                    activeFill.style.transform = `scaleX(${progress})`;
                }
                if (progress < 1) {
                    autoplayRaf = requestAnimationFrame(tick);
                } else {
                    setSlide(currentIndex + 1);
                }
            }

            autoplayRaf = requestAnimationFrame(tick);
        }

        function pauseAutoplay() {
            isPaused = true;
            if (autoplayRaf) {
                cancelAnimationFrame(autoplayRaf);
                autoplayRaf = null;
            }
        }

        function resumeAutoplay() {
            if (!isPaused) return;
            isPaused = false;
            startAutoplay();
        }

        wrap._resetAutoplay = () => {
            isPaused = false;
            startAutoplay();
        };

        // Arrow navigation
        if (prevBtn) {
            prevBtn.addEventListener('click', (e) => {
                e.preventDefault();
                setSlide(currentIndex - 1);
            });
        }

        if (nextBtn) {
            nextBtn.addEventListener('click', (e) => {
                e.preventDefault();
                setSlide(currentIndex + 1);
            });
        }

        // Clicking side cards jumps to them
        cards.forEach((card, i) => {
            card.addEventListener('click', (e) => {
                if (e.target.closest('a') || e.target.closest('button')) return;
                const state = card.getAttribute('data-state');
                if (state !== 'active' && state !== 'hidden') {
                    setSlide(i);
                }
            });
        });

        // Clicking pip jumps to slide
        pagers.forEach((pip, i) => {
            pip.addEventListener('click', () => {
                setSlide(i);
            });
        });

        // Pause on hover
        wrap.addEventListener('mouseenter', pauseAutoplay);
        wrap.addEventListener('mouseleave', resumeAutoplay);

        // Keyboard arrow navigation
        if (stage) {
            stage.addEventListener('keydown', (e) => {
                if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                    e.preventDefault();
                    setSlide(currentIndex + 1);
                } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                    e.preventDefault();
                    setSlide(currentIndex - 1);
                }
            });
        }

        // Touch swipe gestures
        let touchStartX = 0;
        wrap.addEventListener('touchstart', (e) => {
            if (e.touches && e.touches.length === 1) {
                touchStartX = e.touches[0].clientX;
            }
        }, { passive: true });

        wrap.addEventListener('touchend', (e) => {
            if (e.changedTouches && e.changedTouches.length) {
                const diff = e.changedTouches[0].clientX - touchStartX;
                if (Math.abs(diff) > 40) {
                    if (diff < 0) {
                        setSlide(currentIndex + 1);
                    } else {
                        setSlide(currentIndex - 1);
                    }
                }
            }
        }, { passive: true });

        // Mouse drag swipe
        let isMouseDown = false;
        let mouseStartX = 0;

        stage.addEventListener('mousedown', (e) => {
            if (e.target.closest('a') || e.target.closest('button')) return;
            isMouseDown = true;
            mouseStartX = e.clientX;
        });

        window.addEventListener('mouseup', (e) => {
            if (!isMouseDown) return;
            isMouseDown = false;
            const diff = e.clientX - mouseStartX;
            if (Math.abs(diff) > 45) {
                if (diff < 0) {
                    setSlide(currentIndex + 1);
                } else {
                    setSlide(currentIndex - 1);
                }
            }
        });

        // Initial setup
        setSlide(0);
    }

    window.initCertificationsChain = initCertificationsChain;
    window.initCertificationsHaze = initCertificationsChain;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initCertificationsChain);
    } else {
        initCertificationsChain();
    }


// Portfolio Tab Functionality
// ==========================================================================
// Featured Articles — Framer Synced Deck Style (https://cultural-universe-619242.framer.app/deck)
// ==========================================================================
function initFeaturedArticlesDeck() {
    const wrap = document.getElementById('articlesDeckWrap');
    if (!wrap) return;

    const cards = Array.from(wrap.querySelectorAll('.deck-card'));
    const dots = Array.from(wrap.querySelectorAll('.deck-dot'));
    const titleEl = document.getElementById('deckActiveTitle');
    const counterEl = document.getElementById('deckActiveCounter');
    const prevBtn = document.getElementById('deckPrevBtn');
    const nextBtn = document.getElementById('deckNextBtn');
    const stage = document.getElementById('deckStage');

    if (!cards.length || !stage) return;

    const n = cards.length;
    let activeIndex = 0; // Starts at card 1 (index 0)

    // Framer Scatter constants
    const angles = [-6.3, 2.5, -3.5, 7.0, -4.9];
    const yOffsets = [6, -8, 10, -12, 4];

    function updateDeck() {
        const stageW = stage.clientWidth || window.innerWidth;
        const isMobile = stageW < 640;
        const cardW = isMobile ? 220 : 270;

        // Dynamic step and fan metrics
        const minStep = isMobile ? 26 : 75;
        const maxStep = isMobile ? 38 : 130;
        const step = Math.min(maxStep, Math.max(minStep, (stageW - cardW) / (n - 1)));
        const spreadOffset = isMobile ? 22 : 45;
        const activeLift = isMobile ? -12 : -18;
        const activeScale = isMobile ? 1.03 : 1.05;

        cards.forEach((card, i) => {
            const isActive = (i === activeIndex);
            const baseRot = angles[i % angles.length];
            const baseY = yOffsets[i % yOffsets.length];

            const baseX = (i - (n - 1) / 2) * step;

            let x = baseX;
            let y = baseY;
            let rot = baseRot;
            let scale = 1;
            let z = i + 1;

            if (isActive) {
                y = activeLift;
                rot = 0;
                scale = activeScale;
                z = 25;
            } else if (i < activeIndex) {
                x -= spreadOffset;
                scale = 0.96;
                z = i + 1;
            } else {
                x += spreadOffset;
                scale = 0.96;
                z = n - i + 1;
            }

            card.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) rotate(${rot}deg) scale(${scale})`;
            card.style.zIndex = z;
            card.classList.toggle('is-active', isActive);
        });

        // Update Dots
        dots.forEach((dot, i) => {
            const isDotActive = (i === activeIndex);
            dot.classList.toggle('active', isDotActive);
            dot.setAttribute('aria-selected', isDotActive ? 'true' : 'false');
        });

        // Update Synchronized Title & Counter
        const activeCard = cards[activeIndex];
        if (activeCard && titleEl) {
            const h4 = activeCard.querySelector('.deck-card-title');
            if (h4) {
                titleEl.style.opacity = '0';
                titleEl.style.transform = 'translateY(4px)';
                setTimeout(() => {
                    titleEl.textContent = h4.textContent;
                    titleEl.style.opacity = '1';
                    titleEl.style.transform = 'translateY(0)';
                }, 140);
            }
        }
        if (counterEl) {
            counterEl.textContent = `${String(activeIndex + 1).padStart(2, '0')} / ${String(n).padStart(2, '0')}`;
        }
    }

    function setActive(idx) {
        activeIndex = (idx + n) % n;
        updateDeck();
    }

    window.updateFeaturedArticlesDeck = function() {
        requestAnimationFrame(() => {
            updateDeck();
        });
    };

    cards.forEach((card, i) => {
        card.addEventListener('click', (e) => {
            if (e.target.closest('a')) return;
            setActive(i);
        });

        card.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                if (e.target.closest('a')) return;
                e.preventDefault();
                setActive(i);
            }
        });
    });

    if (prevBtn) {
        prevBtn.addEventListener('click', () => setActive(activeIndex - 1));
    }
    if (nextBtn) {
        nextBtn.addEventListener('click', () => setActive(activeIndex + 1));
    }

    dots.forEach((dot, i) => {
        dot.addEventListener('click', () => setActive(i));
    });

    // Keyboard Arrow navigation
    stage.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowLeft') {
            e.preventDefault();
            setActive(activeIndex - 1);
        } else if (e.key === 'ArrowRight') {
            e.preventDefault();
            setActive(activeIndex + 1);
        }
    });

    // Touch swipe gestures for mobile
    let touchStartX = 0;
    let touchStartY = 0;
    stage.addEventListener('touchstart', (e) => {
        if (!e.touches || !e.touches[0]) return;
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
    }, { passive: true });

    stage.addEventListener('touchend', (e) => {
        if (!e.changedTouches || !e.changedTouches[0]) return;
        const dx = e.changedTouches[0].clientX - touchStartX;
        const dy = e.changedTouches[0].clientY - touchStartY;
        if (Math.abs(dx) > 35 && Math.abs(dx) > Math.abs(dy)) {
            if (dx < 0) {
                setActive(activeIndex + 1);
            } else {
                setActive(activeIndex - 1);
            }
        }
    }, { passive: true });

    window.addEventListener('resize', updateDeck);

    // Initial render
    updateDeck();
}
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
            if (selectedTab === 'certifications' && typeof initCertificationsChain === 'function') {
                initCertificationsChain();
            }
            if (selectedTab === 'articles' && typeof window.updateFeaturedArticlesDeck === 'function') {
                window.updateFeaturedArticlesDeck();
            }
            if ((selectedTab === 'places' || selectedTab === 'research') && typeof initFloatingCards === 'function') {
                initFloatingCards();
            }
            if (selectedTab === 'achievements' && typeof initFlexibleAccordion === 'function') {
                initFlexibleAccordion();
            }
            if (selectedTab === 'movies' && typeof initVideoWallGallery === 'function') {
                initVideoWallGallery();
            }
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
    initFeaturedArticlesDeck();
    initProfileImageFlip();
});

// Accordion functionality — Framer Motion Cards Style (https://motioncards.framer.website)
document.addEventListener('DOMContentLoaded', function() {
    const accordionSection = document.querySelector('.accordion-section');
    if (!accordionSection) return;
    const items = Array.from(accordionSection.querySelectorAll('.accordion-item'));
    if (!items.length) return;

    function updateCardMorphStates() {
        const activeIdx = items.findIndex(item => item.classList.contains('active'));
        const n = items.length;

        items.forEach((item, i) => {
            const isActive = (i === activeIdx);
            let isTopRounded = false;
            let isBottomRounded = false;
            let hasGap = false;

            if (isActive) {
                isTopRounded = true;
                isBottomRounded = true;
                hasGap = (i < n - 1);
            } else {
                const prevIsActive = (i === 0) || (i - 1 === activeIdx);
                const nextIsActive = (i === n - 1) || (i + 1 === activeIdx);

                isTopRounded = prevIsActive;
                isBottomRounded = nextIsActive;
                hasGap = (nextIsActive && i < n - 1);
            }

            item.classList.toggle('card-top-rounded', isTopRounded);
            item.classList.toggle('card-bottom-rounded', isBottomRounded);
            item.classList.toggle('card-has-gap', hasGap);
        });
    }

    items.forEach(item => {
        const header = item.querySelector('.accordion-header');
        const content = item.querySelector('.accordion-content');
        if (!header || !content) return;

        // Make header accessible via keyboard
        header.setAttribute('tabindex', '0');
        header.setAttribute('role', 'button');
        header.setAttribute('aria-expanded', 'false');

        const toggleAccordion = () => {
            const isActive = item.classList.contains('active');

            // Close all accordion items
            items.forEach(otherItem => {
                const otherHeader = otherItem.querySelector('.accordion-header');
                const otherContent = otherItem.querySelector('.accordion-content');
                otherItem.classList.remove('active');
                if (otherHeader) otherHeader.setAttribute('aria-expanded', 'false');
                if (otherContent) otherContent.style.height = '0px';
            });

            // If it was closed, open it
            if (!isActive) {
                item.classList.add('active');
                header.setAttribute('aria-expanded', 'true');
                content.style.height = content.scrollHeight + 'px';
            }

            updateCardMorphStates();
        };

        item.addEventListener('click', function(e) {
            if (e.target.closest('a')) return;
            toggleAccordion();
        });

        header.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                toggleAccordion();
            }
        });
    });

    // Initialize cards shape on page load
    updateCardMorphStates();

    // Handle responsive window resize to keep open accordion content properly sized
    window.addEventListener('resize', function() {
        const activeItem = document.querySelector('.accordion-item.active .accordion-content');
        if (activeItem) {
            activeItem.style.height = 'auto';
            const newHeight = activeItem.scrollHeight + 'px';
            activeItem.style.height = newHeight;
        }
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

/* ==========================================================================
   Timeline Section - Memory Album 3D Interactive Photo Book
   Faithfully replicated from: https://memoryalbum.framer.website/
   Features 12-segment paper curling, real-time spring physics, pointer drag,
   corner hover curl, 3D perspective mouse tilt, and photo modal zoom.
   ========================================================================== */
(function() {
    'use strict';

    const memoryAlbumPhotos = [
        {
            src: 'assets/img/portfolio/timeline/Got_Married.jpg',
            caption: 'We Chose Each Other',
            date: 'August 2024',
            location: 'Wedding Ceremony',
            story: 'On the day the world celebrates love, we chose each other. Two hearts, one love, bound for always. And we tied the knot with a promise to walk hand in hand through life, loving, growing, and choosing one another every day.'
        },
        {
            src: 'assets/img/portfolio/timeline/Birthday_Celebration_With_My_Love.jpg',
            caption: 'Her Special Day',
            date: 'July 2024',
            location: 'Celebration',
            story: 'Before we could even get over the excitement of our wedding, her birthday came around. We celebrated her special day with happiness. It felt wonderful to spend her birthday with her for the first time as the love of my life.'
        },
        {
            src: 'assets/img/portfolio/timeline/Receiption_With_Colleagues_[Mousumi Industries Limited].JPG',
            caption: 'Cute Family Reception',
            date: 'June 2024',
            location: 'Wedding Reception',
            story: 'A glimpse of my colleagues from Cute Family on my wedding reception day. Thanks to all of you for joining my special event.'
        },
        {
            src: 'assets/img/portfolio/timeline/My_Name_In_Her_Heart.JPG',
            caption: 'Written in Her Heart',
            date: 'May 2024',
            location: 'Bridal Art',
            story: 'You wrote my name on your hand, but I know you wrote it in your heart too. You might ask me, How do you know? I know because my absence makes your heart restless, and my pain hurts you just as much as it hurts me. I saw the love in your eyes, and that told me everything. And that is exactly why I love you this way. Stay just the way you are, my love!'
        },
        {
            src: 'assets/img/portfolio/timeline/Receiption_With_My_Love.jpg',
            caption: 'Reception With My Love',
            date: 'May 2024',
            location: 'Reception Arena',
            story: 'Cherished moments and smiles together during our wedding reception celebrations.'
        },
        {
            src: 'assets/img/portfolio/timeline/Last_day_Hangout_with_Bhai-brothers_of_UITS.jpg',
            caption: 'Last Day at Varsity',
            date: 'April 2024',
            location: 'Campus Hangout',
            story: 'Our last hangout, our last picture together; it is hard to believe this chapter is ended already. Friends like you turned ordinary days into memories. My varsity life feels incomplete without you guys; thank you for everything!'
        },
        {
            src: 'assets/img/portfolio/timeline/Moments_of_UITS.jpg',
            caption: 'Moments of UITS',
            date: 'March 2024',
            location: 'University Campus',
            story: 'A random day with my boys back in varsity. So many laughs, so many moments.'
        },
        {
            src: 'assets/img/portfolio/timeline/A_Moment_with_My_Favorite_Sir.jpg',
            caption: 'With Shayokh Sir',
            date: 'February 2024',
            location: 'Faculty Lounge',
            story: 'What an incredible time we had with you, Shayokh Sir! It was inspiring to hear about your PhD journey and lifestyle. We had a fun and enlightening discussion. Batch 47 eagerly awaits your future visits.'
        },
        {
            src: 'assets/img/portfolio/timeline/Last_Picture_with_Tanzir_Sir_Before_going_for_His_New_Destination.jpg',
            caption: 'Farewell Tanzir Sir',
            date: 'January 2024',
            location: 'Campus Courtyard',
            story: 'A memorable farewell photograph with Tanzir Sir before he embarked on his new destination and academic journey.'
        },
        {
            src: 'assets/img/portfolio/timeline/Celebration_with_our_Chairman_Sir_for_Being_Selected_as_Chairman_of_the_Asian_Archery_Association.jpg',
            caption: 'Asian Archery President',
            date: 'December 2023',
            location: 'Corporate HQ',
            story: 'We celebrate this proud moment as our chairman, Sir of Mousumi Industries Limited, is elected President of World Archery Asia (WAA), marking a historic achievement for Bangladeshi sports administration.',
            isItem11: true
        },
        {
            src: 'assets/img/portfolio/timeline/Treat_for_Getting_My_First_Job.jpg',
            caption: 'First Job Celebration',
            date: 'November 2023',
            location: 'City Bistro',
            story: 'Celebration for landing my first job with my friends: a small treat and a snapshot to remember the start of this new chapter of my life.'
        },
        {
            src: 'assets/img/portfolio/timeline/36_July_[Victory_2.0]_Celebration.jpg',
            caption: '36 July Victory 2.0',
            date: '05 August 2024',
            location: 'Dhaka, Bangladesh',
            story: 'On the day the tyrant regime fell, we joined the people to celebrate. It was the day we truly felt independent and free to live as human beings.'
        },
        {
            src: 'assets/img/portfolio/timeline/My_Boys.jpg',
            caption: 'My Boys',
            date: 'October 2023',
            location: 'Varsity Grounds',
            story: 'So many days, so many memories. I will always remember you guys.'
        },
        {
            src: 'assets/img/portfolio/timeline/At_Floating_Market_Barisal.jpg',
            caption: 'Floating Market Barisal',
            date: 'September 2023',
            location: 'Barisal, Bangladesh',
            story: 'Exploring the picturesque floating markets of Barisal, capturing early morning life on the waterways.'
        },
        {
            src: "assets/img/portfolio/timeline/St. Martin's_Moments.jpg",
            caption: "St. Martin's Hammock",
            date: 'August 2023',
            location: "St. Martin's Island",
            story: 'A quiet afternoon, the sun melting into the seaside, and just me swinging on a hammock; pure peace in a single moment.'
        },
        {
            src: "assets/img/portfolio/timeline/St. Martin's_Speedboat_Thrill.jpg",
            caption: 'Speedboat Thrill',
            date: 'August 2023',
            location: 'Bay of Bengal',
            story: 'Took the speedboat to reach St. Martin Island since we were late. Evening settled in, everything felt eerily still, and then... a terrified scream from someone made the whole ride way more intense.'
        },
        {
            src: 'assets/img/portfolio/timeline/Last_Picture_of_the_Chandpur_Tour.jpg',
            caption: 'Chandpur Tour',
            date: 'July 2023',
            location: 'Chandpur Estuary',
            story: 'Sudden plans always feel special. Endless laughs, unforgettable memories, and our last tour before stepping into the corporate world; moments I will always carry with me.'
        },
        {
            src: 'assets/img/portfolio/timeline/Childhood_Village.jpg',
            caption: 'Childhood Village',
            date: 'June 2023',
            location: 'Ancestral Countryside',
            story: 'Though it is not my home village, I have many memories here. I visited often and experienced village life. I always felt that these were the real village scenes that I dreamed of.'
        },
        {
            src: 'assets/img/portfolio/timeline/Shohel_Bhai_&_I_at_the_Early_Age.jpg',
            caption: 'Shohel Bhai & Childhood',
            date: 'Childhood Memory',
            location: 'Home',
            story: 'Somehow our parents knew we would be more than cousins. Like friends, brothers, and partners in crime. From childhood to now, every moment with you has been unforgettable. Miss you, Shohel Bhai!'
        },
        {
            src: 'assets/img/portfolio/timeline/Last_Class_of_the_School_Life.jpg',
            caption: 'School Life Farewell',
            date: 'School Days',
            location: 'Classroom',
            story: 'The final moments sitting together in our school uniform before stepping into college and the wider world.'
        }
    ];

    let isAlbumBuilt = false;

    // High-Res Image Zoom Modal
    function openImageZoom(imageSrc, imageAlt, location, date, isItem11 = false) {
        const existingModal = document.querySelector('.photo-zoom-modal');
        if (existingModal) existingModal.remove();

        const modal = document.createElement('div');
        modal.className = 'photo-zoom-modal';

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
                <button class="close-modal" aria-label="Close modal">&times;</button>
                <div class="photo-zoom-image-wrapper">
                    <img src="${imageSrc}" alt="${imageAlt}">
                </div>
                <div class="photo-zoom-info">
                    <div class="photo-zoom-metadata">
                        <span class="photo-zoom-date"><i class="fas fa-calendar-alt"></i> ${date || '2024'}</span>
                        <span class="photo-zoom-location"><i class="fas fa-map-marker-alt"></i> ${location || 'Personal Journey'}</span>
                    </div>
                    <p class="photo-zoom-story">${imageAlt}</p>
                    ${buttonHTML}
                </div>
            </div>
        `;

        document.body.appendChild(modal);
        modal.offsetHeight; // trigger reflow
        modal.classList.add('active');

        function closeModal() {
            modal.classList.remove('active');
            setTimeout(() => { modal.remove(); }, 300);
        }

        modal.querySelector('.close-modal').addEventListener('click', closeModal);
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeModal();
        });

        const handleEscape = (e) => {
            if (e.key === 'Escape') {
                closeModal();
                document.removeEventListener('keydown', handleEscape);
            }
        };
        document.addEventListener('keydown', handleEscape);
    }

    /* ==========================================================================
       Snap Gallery - Polaroid Carousel Component (Desktop Version Only)
       Faithfully replicated from: https://snapgallery.framer.website/
       ========================================================================== */
    let isSnapGalleryBuilt = false;
    let snapCurrentX = 0;
    let snapMinX = 0;
    let snapAnimateTo = null;

    function initSnapGallery() {
        const wrap = document.getElementById('snapGalleryWrap');
        const viewport = document.getElementById('snapGalleryViewport');
        const track = document.getElementById('snapGalleryTrack');
        const prevBtn = document.getElementById('snapGalleryPrev');
        const nextBtn = document.getElementById('snapGalleryNext');

        if (!wrap || !viewport || !track) return;

        // Build polaroid cards once from memoryAlbumPhotos
        if (!isSnapGalleryBuilt) {
            isSnapGalleryBuilt = true;
            // Playful rotation angles matching Framer Snap Gallery (-10 to +10 deg)
            const rotations = [-7, 5, -8, 6, -4, 7, -6, 8, -5, 6, -7, 4, -8, 7, -5, 6, -6, 5, -7, 6];
            const tapeRotations = [1.2, -1.5, 0.8, -1.2, 1.5, -0.9, 1.4, -1.1, 0.7, -1.3, 1.1, -0.8, 1.6, -1.4, 0.9, -1.2, 1.3, -1.5, 0.8, -1.1];

            track.innerHTML = memoryAlbumPhotos.map((photo, index) => {
                const rot = rotations[index % rotations.length];
                const tapeRot = tapeRotations[index % tapeRotations.length];
                const safeSrc = encodeURI(photo.src);
                return `
                    <div class="snapgallery-card" data-index="${index}" style="--card-rot: ${rot}deg;" role="group" aria-label="${photo.caption || 'Timeline Photo'}">
                        <div class="snapgallery-tape" style="--tape-rot: ${tapeRot}deg;" aria-hidden="true"></div>
                        <div class="snapgallery-media">
                            <img src="${safeSrc}" alt="${photo.caption || ''}" draggable="false" loading="lazy">
                        </div>
                        <div class="snapgallery-caption">
                            <p class="snapgallery-title">${photo.caption || ''}</p>
                            <p class="snapgallery-date">${photo.date || ''}</p>
                        </div>
                    </div>
                `;
            }).join('');
        }

        function updateBounds() {
            const cardWidthWithGap = 280 + 48; // 280px card + 48px gap
            const totalWidth = memoryAlbumPhotos.length * cardWidthWithGap - 48;
            const viewportWidth = viewport.clientWidth;
            snapMinX = Math.min(0, viewportWidth - totalWidth - 24);
            updateNavState();
        }

        function updateNavState() {
            if (prevBtn) prevBtn.disabled = snapCurrentX >= -2;
            if (nextBtn) nextBtn.disabled = snapCurrentX <= snapMinX + 2;
        }

        function setTranslateX(x, transition = '') {
            snapCurrentX = x;
            track.style.transition = transition;
            track.style.transform = `translate3d(${x}px, 0, 0)`;
            updateNavState();
        }

        snapAnimateTo = function(targetX, withSpring = true) {
            const clampedX = Math.max(snapMinX, Math.min(0, targetX));
            const transition = withSpring 
                ? 'transform 0.45s cubic-bezier(0.22, 1, 0.36, 1)' 
                : 'transform 0.25s ease-out';
            setTranslateX(clampedX, transition);
        };

        // Pointer Drag Physics (Framer Gestures)
        let isDown = false;
        let isDragging = false;
        let startX = 0;
        let dragStartTranslateX = 0;
        let lastX = 0;
        let lastTime = 0;
        let velocity = 0;

        viewport.onpointerdown = (e) => {
            if (e.button !== undefined && e.button !== 0) return;
            isDown = true;
            isDragging = false;
            startX = e.clientX;
            dragStartTranslateX = snapCurrentX;
            lastX = e.clientX;
            lastTime = performance.now();
            velocity = 0;
            track.style.transition = 'none';
            try { viewport.setPointerCapture(e.pointerId); } catch (_) {}
        };

        viewport.onpointermove = (e) => {
            if (!isDown) return;
            const dx = e.clientX - startX;
            if (!isDragging && Math.abs(dx) > 5) {
                isDragging = true;
                viewport.classList.add('is-dragging');
            }
            if (isDragging) {
                let targetX = dragStartTranslateX + dx;
                // Framer dragElastic: 0.2 resistance past boundaries
                if (targetX > 0) {
                    targetX = targetX * 0.2;
                } else if (targetX < snapMinX) {
                    targetX = snapMinX + (targetX - snapMinX) * 0.2;
                }
                setTranslateX(targetX, 'none');

                const now = performance.now();
                const dt = now - lastTime;
                if (dt > 0) {
                    velocity = (e.clientX - lastX) / dt;
                    lastX = e.clientX;
                    lastTime = now;
                }
            }
        };

        const handlePointerEnd = (e) => {
            if (!isDown) return;
            isDown = false;
            viewport.classList.remove('is-dragging');
            try { viewport.releasePointerCapture(e.pointerId); } catch (_) {}

            if (isDragging) {
                const momentumX = snapCurrentX + velocity * 180;
                snapAnimateTo(momentumX, true);
            } else {
                const card = e.target.closest('.snapgallery-card');
                if (card) {
                    const idx = parseInt(card.dataset.index, 10);
                    const photo = memoryAlbumPhotos[idx];
                    if (photo) {
                        openImageZoom(photo.src, photo.story || photo.caption, photo.location, photo.date, photo.isItem11);
                    }
                }
            }
        };

        viewport.onpointerup = handlePointerEnd;
        viewport.onpointercancel = handlePointerEnd;

        // Wheel horizontal glide
        viewport.onwheel = (e) => {
            const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
            if (Math.abs(delta) > 2) {
                e.preventDefault();
                snapAnimateTo(snapCurrentX - delta * 1.5, false);
            }
        };

        // Navigation Arrows
        if (prevBtn) {
            prevBtn.onclick = () => snapAnimateTo(snapCurrentX + 328, true);
        }
        if (nextBtn) {
            nextBtn.onclick = () => snapAnimateTo(snapCurrentX - 328, true);
        }

        updateBounds();
        if (window.ResizeObserver) {
            const ro = new ResizeObserver(() => updateBounds());
            ro.observe(viewport);
        }
        window.addEventListener('resize', updateBounds);
    }

    function initMemoryAlbum() {
        const wrap = document.getElementById('memoryAlbumWrap');
        const stage = document.getElementById('maStage');
        const hub = document.getElementById('maBookHub');
        const boardL = document.getElementById('maBoardLeft');
        const boardR = document.getElementById('maBoardRight');
        const stackL = document.getElementById('maStackLeft');
        const stackR = document.getElementById('maStackRight');
        const flatL = document.getElementById('maFlatLeft');
        const flatR = document.getElementById('maFlatRight');
        const flatLContent = document.getElementById('maFlatLeftContent');
        const flatRContent = document.getElementById('maFlatRightContent');
        const castL = document.getElementById('maCastLeft');
        const castR = document.getElementById('maCastRight');
        const leavesContainer = document.getElementById('maLeavesContainer');
        const dotsWrap = document.getElementById('maDots');
        const counterEl = document.getElementById('maCounter');
        const prevBtn = document.getElementById('maPrevBtn');
        const nextBtn = document.getElementById('maNextBtn');

        if (!wrap || !leavesContainer || isAlbumBuilt) return;
        isAlbumBuilt = true;

        // Build Leaves data structure matching Framer Memory Album
        const leaves = [];
        // 0: Front Hardcover
        leaves.push({
            board: true,
            front: { kind: 'cover', img: memoryAlbumPhotos[0].src, title: 'Life Timeline', sub: 'Volume One', photoObj: memoryAlbumPhotos[0] },
            back: { kind: 'endpaper' }
        });

        // Inside Spreads for all 18 photos
        for (let i = 0; i < memoryAlbumPhotos.length; i += 2) {
            leaves.push({
                board: false,
                front: { kind: 'photo', ...memoryAlbumPhotos[i], folio: i + 1, photoObj: memoryAlbumPhotos[i] },
                back: i + 1 < memoryAlbumPhotos.length 
                    ? { kind: 'photo', ...memoryAlbumPhotos[i + 1], folio: i + 2, photoObj: memoryAlbumPhotos[i + 1] }
                    : { kind: 'endpaper' }
            });
        }

        // Rear Hardcover
        leaves.push({
            board: true,
            front: { kind: 'endpaper' },
            back: { kind: 'cover', isRear: true, title: 'Memories & Milestones', sub: 'The End' }
        });

        const totalLeaves = leaves.length;
        const Y = 12; // 12 nested segments per turning leaf for physical paper curvature

        // Authentic Framer state
        const deck = {
            p: Array(totalLeaves).fill(0),
            v: Array(totalLeaves).fill(0),
            goal: Array(totalLeaves).fill(0),
            bend: Array(totalLeaves).fill(0),
            skew: Array(totalLeaves).fill(0),
            queue: [],
            dragK: -1,
            hoverK: -1,
            hoverP: 0,
            hoverV: 0,
            tilt: 0,
            tiltGoal: 0,
            lastTouch: 0,
            act: [],
            right: 0,
            left: -1,
            pos: 0
        };
        window.__deck = deck;

        // Framer spring physics constants
        const clamp = (val, min, max) => Math.min(max, Math.max(min, val));
        const speed = 1.15, feel = 0.45, curl = 1.0;
        const springK = 95 * speed * speed * (1.2 - 0.55 * feel);
        const springDamp = 2 * (0.9 - 0.32 * feel) * Math.sqrt(springK);

        // Framer relative segment angles calculator fo()
        const segAngles = Array(Y).fill(0);
        function fo(prog, bendAmt, outAngles) {
            const r = 180 * prog;
            const i = 78 * bendAmt * Math.sin(Math.PI * prog);
            for (let s = 0; s < Y; s++) {
                const frac = (s + 1) / Y;
                outAngles[s] = clamp(r + i * (Math.pow(frac, 1.7) - 0.36), 0, 180);
            }
        }

        // Lighting curve formulas
        const pLight = deg => 0.5 * 0.6 * (deg <= 90 ? Math.pow(deg / 90, 1.35) : 1);
        const mLight = deg => pLight(180 - deg);

        // Render HTML for side content
        function renderSideContent(side, face) {
            if (!side) return '';
            const isFront = face === 'front';
            if (side.kind === 'cover') {
                const coverSrc = side.img ? encodeURI(side.img) : '';
                return `
                    <div class="ma-page-cover">
                        ${coverSrc ? `<img src="${coverSrc}" class="ma-cover-img" alt="" loading="eager">` : ''}
                        <div class="ma-cover-vignette"></div>
                        <div class="ma-cover-text">
                            <div class="ma-cover-subtitle">${side.sub || ''}</div>
                            <div class="ma-cover-title">${side.title || ''}</div>
                        </div>
                        <div class="${isFront ? 'ma-spine-front' : 'ma-spine-back'}"></div>
                    </div>
                `;
            }
            if (side.kind === 'endpaper') {
                return `
                    <div class="ma-page-endpaper">
                        <div class="${isFront ? 'ma-spine-front' : 'ma-spine-back'}"></div>
                    </div>
                `;
            }
            // Normal photo page
            const safeImgSrc = encodeURI(side.src);
            return `
                <div class="ma-page-photo-card">
                    <div class="ma-photo-inner-wrap" data-img="${safeImgSrc}">
                        <img src="${safeImgSrc}" alt="${side.caption}" loading="eager">
                    </div>
                    <div class="ma-page-footer" style="${isFront ? '' : 'flex-direction: row-reverse;'}">
                        <span class="ma-page-caption">${side.caption}</span>
                        <span class="ma-page-folio">${side.folio < 10 ? '0' + side.folio : side.folio}</span>
                    </div>
                    <div class="${isFront ? 'ma-spine-front' : 'ma-spine-back'}"></div>
                </div>
            `;
        }

        // Build 12-segment nested leaf DOM element
        function createTurningLeafElement(leafIdx) {
            const leafData = leaves[leafIdx];
            const root = document.createElement('div');
            root.className = 'ma-turning-leaf';
            root.id = `leaf-${leafIdx}`;

            const segRefs = [];
            const fOverlays = [];
            const bOverlays = [];

            let nestedChild = null;
            for (let s = Y - 1; s >= 0; s--) {
                const segDiv = document.createElement('div');
                segDiv.className = 'ma-slice-container';
                segDiv.style.left = s === 0 ? '0' : `calc(var(--lw) / ${Y})`;
                segDiv.style.width = `calc(var(--lw) / ${Y} + 0.7px)`;

                // Front slice
                const frontFace = document.createElement('div');
                frontFace.className = 'ma-slice-face';
                const frontInner = document.createElement('div');
                frontInner.className = 'ma-slice-inner';
                frontInner.style.left = `calc(var(--lw) * ${(-s / Y).toFixed(5)})`;
                frontInner.innerHTML = renderSideContent(leafData.front, 'front');
                const fOverlay = document.createElement('div');
                fOverlay.className = 'ma-slice-overlay';
                frontFace.appendChild(frontInner);
                frontFace.appendChild(fOverlay);

                // Back slice
                const backFace = document.createElement('div');
                backFace.className = 'ma-slice-face';
                backFace.style.transform = 'rotateY(180deg)';
                const backInner = document.createElement('div');
                backInner.className = 'ma-slice-inner';
                backInner.style.left = `calc(var(--lw) * ${(-(Y - 1 - s) / Y).toFixed(5)})`;
                backInner.innerHTML = renderSideContent(leafData.back, 'back');
                const bOverlay = document.createElement('div');
                bOverlay.className = 'ma-slice-overlay';
                backFace.appendChild(backInner);
                backFace.appendChild(bOverlay);

                segDiv.appendChild(frontFace);
                segDiv.appendChild(backFace);
                if (nestedChild) segDiv.appendChild(nestedChild);

                nestedChild = segDiv;
                segRefs[s] = segDiv;
                fOverlays[s] = fOverlay;
                bOverlays[s] = bOverlay;
            }
            root.appendChild(nestedChild);

            return { root, s: segRefs, f: fOverlays, b: bOverlays };
        }

        const leafNodes = new Map();

        // Calculate layout active sets vo()
        function vo() {
            const n = deck.p.length;
            const act = [];
            let right = -1, left = -1, pos = 0;
            const isSettled = i => i !== deck.dragK && i !== deck.hoverK && (deck.p[i] <= 0.003 || deck.p[i] >= 0.997);
            for (let i = 0; i < n; i++) {
                pos += deck.goal[i];
                if (!isSettled(i)) act.push(i);
            }
            for (let i = 0; i < n; i++) {
                if (isSettled(i) && deck.p[i] <= 0.003) { right = i; break; }
            }
            for (let i = n - 1; i >= 0; i--) {
                if (isSettled(i) && deck.p[i] >= 0.997) { left = i; break; }
            }
            return { act, right, left, pos };
        }

        let prevLeft = -999, prevRight = -999;

        // Render paint loop l()
        function paint() {
            const p0 = deck.p[0];
            const pLast = deck.p[totalLeaves - 1];
            wrap.style.setProperty('--off', (-0.5 * (1 - p0) + 0.5 * pLast).toFixed(4));
            wrap.style.setProperty('--tilt', `${deck.tilt.toFixed(3)}deg`);

            // Hardcover boards
            if (boardL) boardL.style.opacity = deck.left >= 0 ? '1' : '0';
            if (boardR) boardR.style.opacity = deck.right >= 0 ? '1' : '0';

            // Paper stack thickness
            const rightStackCount = deck.right >= 0 ? totalLeaves - deck.right : 0;
            const leftStackCount = deck.left >= 0 ? deck.left + 1 : 0;
            const rThick = Math.min(8, Math.max(0, rightStackCount * 0.8));
            const lThick = Math.min(8, Math.max(0, leftStackCount * 0.8));

            if (stackR) {
                stackR.style.width = `${rThick.toFixed(1)}px`;
                stackR.style.display = rThick > 0.5 ? 'block' : 'none';
            }
            if (stackL) {
                stackL.style.width = `${lThick.toFixed(1)}px`;
                stackL.style.left = `calc(var(--pw) * -1 - ${lThick.toFixed(1)}px)`;
                stackL.style.display = lThick > 0.5 ? 'block' : 'none';
            }

            // Flat base pages update when resting index changes
            if (deck.left !== prevLeft) {
                prevLeft = deck.left;
                if (flatL) {
                    if (deck.left >= 0) {
                        flatL.style.display = 'block';
                        flatLContent.innerHTML = renderSideContent(leaves[deck.left].back, 'back');
                        bindPhotoZoom(flatLContent, leaves[deck.left].back);
                    } else {
                        flatL.style.display = 'none';
                    }
                }
            }
            if (deck.right !== prevRight) {
                prevRight = deck.right;
                if (flatR) {
                    if (deck.right >= 0) {
                        flatR.style.display = 'block';
                        flatRContent.innerHTML = renderSideContent(leaves[deck.right].front, 'front');
                        bindPhotoZoom(flatRContent, leaves[deck.right].front);
                    } else {
                        flatR.style.display = 'none';
                    }
                }
            }

            // Active turning leaves cleanup
            const activeSet = new Set(deck.act);
            for (let [k, node] of leafNodes.entries()) {
                if (!activeSet.has(k)) {
                    if (node.root.parentNode) node.root.parentNode.removeChild(node.root);
                    leafNodes.delete(k);
                }
            }

            // Render 12-segment active turning leaves with 3D paper curl
            for (let t of deck.act) {
                let node = leafNodes.get(t);
                if (!node) {
                    node = createTurningLeafElement(t);
                    leafNodes.set(t, node);
                    leavesContainer.appendChild(node.root);
                }

                const prog = deck.p[t];
                fo(prog, deck.bend[t] * (leaves[t].board ? 0.22 : 1), segAngles);

                const zOff = (prog < 0.5 ? totalLeaves - t : t + 1) * 0.35 + 0.6;
                const skewDeg = deck.skew[t] * 5 * curl * Math.sin(Math.PI * prog) * (leaves[t].board ? 0.3 : 1);
                node.root.style.transform = `translateZ(${zOff.toFixed(2)}px) skewY(${skewDeg.toFixed(3)}deg)`;

                let u = 0;
                for (let s = 0; s < Y; s++) {
                    const seg = node.s[s];
                    const delta = segAngles[s] - u;
                    u = segAngles[s];
                    if (seg) seg.style.transform = `rotateY(${(-delta).toFixed(3)}deg)`;

                    const aMid = s ? (segAngles[s - 1] + segAngles[s]) / 2 : segAngles[0];
                    const oMid = s < Y - 1 ? (segAngles[s] + segAngles[s + 1]) / 2 : segAngles[s];
                    const curv = Math.abs((s < Y - 1 ? segAngles[s + 1] : segAngles[s]) - (s ? segAngles[s - 1] : segAngles[s]));
                    const highlight = `linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,${(Math.min(0.32, curv * 0.02) * 0.6).toFixed(3)}), rgba(255,255,255,0))`;

                    if (node.f[s]) {
                        node.f[s].style.background = `linear-gradient(90deg, rgba(0,0,0,${pLight(aMid).toFixed(3)}), rgba(0,0,0,${pLight(oMid).toFixed(3)})), ${highlight}`;
                    }
                    if (node.b[s]) {
                        node.b[s].style.background = `linear-gradient(90deg, rgba(0,0,0,${mLight(oMid).toFixed(3)}), rgba(0,0,0,${mLight(aMid).toFixed(3)})), ${highlight}, linear-gradient(rgba(96,80,56,0.08), rgba(96,80,56,0.08))`;
                    }
                }
            }

            // Cast dynamic shadow onto flat pages below
            const castShadowInfo = e => {
                if (e < 0 || e >= totalLeaves || deck.act.indexOf(e) < 0) return null;
                fo(deck.p[e], deck.bend[e] * (leaves[e].board ? 0.22 : 1), segAngles);
                return {
                    cos: Math.cos(segAngles[Y - 1] * Math.PI / 180),
                    alpha: (0.3 * Math.pow(Math.sin(Math.PI * deck.p[e]), 0.6)).toFixed(3)
                };
            };

            const castRInfo = deck.right >= 0 ? castShadowInfo(deck.right - 1) : null;
            if (castR && castRInfo && castRInfo.cos > 0) {
                const e = castRInfo.cos * 100;
                castR.style.background = `linear-gradient(90deg, rgba(0,0,0,0) ${Math.max(0, e - 1).toFixed(1)}%, rgba(0,0,0,${castRInfo.alpha}) ${e.toFixed(1)}%, rgba(0,0,0,0) ${Math.min(100, e + 24).toFixed(1)}%)`;
            } else if (castR) {
                castR.style.background = 'none';
            }

            const castLInfo = deck.left >= 0 ? castShadowInfo(deck.left + 1) : null;
            if (castL && castLInfo && castLInfo.cos < 0) {
                const e = (1 + castLInfo.cos) * 100;
                castL.style.background = `linear-gradient(90deg, rgba(0,0,0,0) ${Math.max(0, e - 24).toFixed(1)}%, rgba(0,0,0,${castLInfo.alpha}) ${e.toFixed(1)}%, rgba(0,0,0,0) ${Math.min(100, e + 1).toFixed(1)}%)`;
            } else if (castL) {
                castL.style.background = 'none';
            }

            // Dots & Counter updates
            const dots = dotsWrap.querySelectorAll('.ma-dot');
            dots.forEach((d, idx) => d.classList.toggle('active', idx === deck.pos));
            const curStr = deck.pos === 0 ? "Cover" : deck.pos === totalLeaves ? "End" : (deck.pos < 10 ? '0' + deck.pos : deck.pos);
            if (counterEl) {
                counterEl.textContent = `${curStr} / ${totalLeaves < 10 ? '0' + totalLeaves : totalLeaves}`;
            }
        }

        function bindPhotoZoom(container, sideData) {
            if (!container || !sideData || !sideData.photoObj) return;
            const photoWrap = container.querySelector('.ma-photo-inner-wrap, .ma-cover-img');
            if (photoWrap) {
                photoWrap.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const p = sideData.photoObj;
                    openImageZoom(p.src, p.story || p.caption, p.location, p.date, !!p.isItem11);
                });
            }
        }

        // Animation Loop
        let animId = null;
        let lastTime = 0;

        function step(now) {
            animId = 0;
            const dt = Math.min(1 / 30, Math.max(1 / 240, (now - lastTime) / 1000));
            lastTime = now;

            // Process queued riffles
            while (deck.queue.length && deck.queue[0].at <= now) {
                const item = deck.queue.shift();
                deck.goal[item.k] = item.g;
                deck.v[item.k] += item.g ? 0.8 : -0.8;
            }

            let isMoving = deck.queue.length > 0;

            // Spring physics simulation
            for (let e = 0; e < totalLeaves; e++) {
                if (e === deck.dragK) continue;
                const target = e === deck.hoverK ? deck.hoverP : deck.goal[e];
                const accel = springK * (target - deck.p[e]) - springDamp * deck.v[e];
                deck.v[e] += accel * dt;
                deck.p[e] += deck.v[e] * dt;
                if (deck.p[e] < 0) { deck.p[e] = 0; if (deck.v[e] < 0) deck.v[e] = -deck.v[e] * 0.18; }
                if (deck.p[e] > 1) { deck.p[e] = 1; if (deck.v[e] > 0) deck.v[e] = -deck.v[e] * 0.18; }
            }

            // Cascade collision prevention between leaves
            for (let e = 0; e < totalLeaves - 1; e++) {
                const limit = deck.p[e] >= 0.985 ? 1 : Math.max(0, deck.p[e] - 0.035);
                if (deck.p[e + 1] > limit) {
                    deck.p[e + 1] = limit;
                    if (deck.v[e + 1] > deck.v[e]) deck.v[e + 1] = deck.v[e];
                }
            }

            // Bend and Skew transitions
            for (let e = 0; e < totalLeaves; e++) {
                const target = e === deck.hoverK ? deck.hoverP : deck.goal[e];
                let aTarget = 0, sTarget = 0;
                if (e === deck.dragK && dragPtr) {
                    aTarget = curl * (dragPtr.side * 0.8 + clamp(dragPtr.vp * 0.25, -0.7, 0.7));
                    sTarget = dragPtr.v0;
                } else if (e === deck.hoverK) {
                    aTarget = curl * 1.6 * (deck.hoverP < 0.5 ? 1 : -1);
                    sTarget = deck.hoverV;
                } else if (Math.abs(target - deck.p[e]) > 0.002) {
                    aTarget = curl * (target > deck.p[e] ? 1 : -1);
                }

                deck.bend[e] += (aTarget - deck.bend[e]) * Math.min(1, dt * 9);
                deck.skew[e] += (sTarget - deck.skew[e]) * Math.min(1, dt * 7);

                if (e === deck.dragK) isMoving = true;
                else if (Math.abs(target - deck.p[e]) < 0.004 && Math.abs(deck.v[e]) < 0.015) {
                    deck.p[e] = target;
                    deck.v[e] = 0;
                } else {
                    isMoving = true;
                }

                if (Math.abs(aTarget - deck.bend[e]) > 0.01 || Math.abs(sTarget - deck.skew[e]) > 0.01) {
                    isMoving = true;
                } else {
                    deck.bend[e] = aTarget;
                    deck.skew[e] = sTarget;
                }
            }

            // 3D perspective mouse tilt
            deck.tilt += (deck.tiltGoal - deck.tilt) * Math.min(1, dt * 6);
            if (Math.abs(deck.tiltGoal - deck.tilt) > 0.02) isMoving = true;
            else deck.tilt = deck.tiltGoal;

            // Update layout partition
            const state = vo();
            deck.act = state.act;
            deck.right = state.right;
            deck.left = state.left;
            deck.pos = state.pos;

            paint();

            if (isMoving) {
                animId = requestAnimationFrame(step);
            }
        }

        function wake() {
            if (!animId) {
                lastTime = performance.now();
                animId = requestAnimationFrame(step);
            }
        }

        function turn(dir) {
            deck.queue.length = 0;
            deck.hoverK = -1;
            const cur = deck.pos;
            let targetIdx = -1;
            if (dir > 0 && cur < totalLeaves) {
                targetIdx = cur;
                deck.goal[targetIdx] = 1;
                deck.v[targetIdx] += 0.5;
            } else if (dir < 0 && cur > 0) {
                targetIdx = cur - 1;
                deck.goal[targetIdx] = 0;
                deck.v[targetIdx] -= 0.5;
            }
            if (targetIdx >= 0) wake();
        }

        function riffleTo(spreadIdx) {
            const target = clamp(Math.round(spreadIdx), 0, totalLeaves);
            deck.queue.length = 0;
            deck.hoverK = -1;
            const cur = deck.pos;
            const interval = 72;
            const now = performance.now();

            if (target > cur) {
                for (let k = cur; k < target; k++) {
                    deck.queue.push({ k, g: 1, at: now + (k - cur) * interval });
                }
            } else {
                for (let k = cur - 1, stepCount = 0; k >= target; k--, stepCount++) {
                    deck.queue.push({ k, g: 0, at: now + stepCount * interval });
                }
            }
            wake();
        }

        // Initialize scrubber dots
        dotsWrap.innerHTML = '';
        for (let i = 0; i <= totalLeaves; i++) {
            const dot = document.createElement('button');
            dot.type = 'button';
            dot.className = 'ma-dot' + (i === 0 ? ' active' : '');
            dot.setAttribute('aria-label', `Go to spread ${i + 1}`);
            dot.addEventListener('click', () => riffleTo(i));
            dotsWrap.appendChild(dot);
        }

        // Control buttons
        if (prevBtn) prevBtn.addEventListener('click', () => turn(-1));
        if (nextBtn) nextBtn.addEventListener('click', () => turn(1));

        // Pointer & Drag Interaction (Framer yo logic)
        let dragPtr = null;

        function getPointerBookCoords(cx, cy) {
            const rect = wrap.getBoundingClientRect();
            const h = Math.min(rect.height * 0.68, (rect.width * 0.68) / (2 * 0.76));
            const w = h * 0.76;
            const off = -0.5 * (1 - deck.p[0]) + 0.5 * deck.p[totalLeaves - 1];
            const midX = rect.left + rect.width / 2;
            const midY = rect.top + rect.height / 2;
            const u = (cx - midX - off * w) / w;
            const v = (cy - midY) / (h / 2);
            let side = 0;
            if (Math.abs(v) <= 1) {
                if (u >= 0 && u <= 1 && deck.p[totalLeaves - 1] < 0.5) side = 1;
                else if (u < 0 && u >= -1 && deck.p[0] > 0.5) side = -1;
            }
            return { u, v, side, ty: (cy - midY) / Math.max(1, rect.height / 2) };
        }

        wrap.addEventListener('pointerdown', e => {
            if (e.button !== 0 && e.button !== undefined) return;
            const coords = getPointerBookCoords(e.clientX, e.clientY);
            if (coords.side) {
                dragPtr = {
                    id: e.pointerId,
                    side: coords.side,
                    x0: e.clientX,
                    y0: e.clientY,
                    u0: coords.u,
                    v0: clamp(coords.v, -1, 1),
                    live: false,
                    leaf: -1,
                    uEdge: 0,
                    vp: 0,
                    t: performance.now()
                };
                try { wrap.setPointerCapture(e.pointerId); } catch (err) {}
            }
        });

        wrap.addEventListener('pointermove', e => {
            const coords = getPointerBookCoords(e.clientX, e.clientY);
            if (e.pointerType === 'mouse') {
                const tiltAmount = clamp(-coords.ty, -1, 1) * 6;
                if (Math.abs(tiltAmount - deck.tiltGoal) > 0.05) {
                    deck.tiltGoal = tiltAmount;
                    wake();
                }
            }

            if (dragPtr && dragPtr.id === e.pointerId) {
                if (!dragPtr.live) {
                    if (Math.hypot(e.clientX - dragPtr.x0, e.clientY - dragPtr.y0) < 6) return;
                    const cur = deck.pos;
                    const targetLeaf = dragPtr.side > 0 ? cur : cur - 1;
                    if (targetLeaf < 0 || targetLeaf >= totalLeaves) {
                        dragPtr = null;
                        return;
                    }
                    deck.queue.length = 0;
                    deck.hoverK = -1;
                    dragPtr.live = true;
                    dragPtr.leaf = targetLeaf;
                    dragPtr.uEdge = Math.cos(Math.PI * deck.p[targetLeaf]);
                    dragPtr.u0 = coords.u;
                    dragPtr.t = performance.now();
                    deck.dragK = targetLeaf;
                    wrap.style.cursor = 'grabbing';
                }
                const leaf = dragPtr.leaf;
                const a = clamp(dragPtr.uEdge + (coords.u - dragPtr.u0), -1, 1);
                const prog = Math.acos(a) / Math.PI;
                const now = performance.now();
                const dt = Math.max(1, now - dragPtr.t) / 1000;
                dragPtr.vp = dragPtr.vp * 0.55 + ((prog - deck.p[leaf]) / dt) * 0.45;
                dragPtr.t = now;
                deck.p[leaf] = prog;
                deck.v[leaf] = dragPtr.vp;
                wake();
                return;
            }

            // Hover corner curl when mouse near edge
            if (e.pointerType === 'mouse' && !dragPtr) {
                const cur = deck.pos;
                let hoverLeaf = -1, hoverProgress = 0;
                const isCorner = Math.abs(coords.v) > 0.5;
                if (coords.side > 0 && coords.u > 0.78 && isCorner && cur < totalLeaves) {
                    if (deck.hoverK === cur || (deck.p[cur] === 0 && deck.goal[cur] === 0)) {
                        hoverLeaf = cur;
                        hoverProgress = 0.05;
                    }
                } else if (coords.side < 0 && coords.u < -0.78 && isCorner && cur > 0) {
                    if (deck.hoverK === cur - 1 || (deck.p[cur - 1] === 1 && deck.goal[cur - 1] === 1)) {
                        hoverLeaf = cur - 1;
                        hoverProgress = 0.95;
                    }
                }

                if (hoverLeaf !== deck.hoverK || (hoverLeaf >= 0 && Math.abs(deck.hoverV - coords.v) > 0.05)) {
                    deck.hoverK = hoverLeaf;
                    deck.hoverP = hoverProgress;
                    deck.hoverV = hoverLeaf >= 0 ? clamp(coords.v, -1, 1) : 0;
                    wake();
                }
                wrap.style.cursor = hoverLeaf >= 0 ? 'grab' : coords.side ? 'pointer' : '';
            }
        });

        function releaseDrag(e) {
            if (!dragPtr || dragPtr.id !== e.pointerId) return;
            try { wrap.releasePointerCapture(e.pointerId); } catch (err) {}
            const ptr = dragPtr;
            dragPtr = null;

            if (ptr.live) {
                const leaf = ptr.leaf;
                const prog = deck.p[leaf];
                const vel = ptr.vp;
                if (ptr.side > 0) {
                    deck.goal[leaf] = +(vel > 1.1 || (prog > 0.5 && vel > -1.1));
                } else {
                    deck.goal[leaf] = (vel < -1.1 || (prog < 0.5 && vel < 1.1)) ? 0 : 1;
                }
                deck.v[leaf] = clamp(vel, -6, 6);
                deck.dragK = -1;
                wrap.style.cursor = '';
                wake();
                return;
            }

            // Tap / click turn
            const dist = Math.hypot(e.clientX - ptr.x0, e.clientY - ptr.y0);
            if (dist < 6) {
                turn(ptr.side);
            }
        }

        wrap.addEventListener('pointerup', releaseDrag);
        wrap.addEventListener('pointercancel', e => {
            if (!dragPtr || dragPtr.id !== e.pointerId) return;
            if (dragPtr.live) {
                deck.goal[dragPtr.leaf] = +(deck.p[dragPtr.leaf] > 0.5);
                deck.dragK = -1;
            }
            dragPtr = null;
            wrap.style.cursor = '';
            wake();
        });

        wrap.addEventListener('pointerleave', () => {
            if (!dragPtr || !dragPtr.live) {
                deck.hoverK = -1;
                deck.tiltGoal = 0;
                wrap.style.cursor = '';
                wake();
            }
        });

        // Touch swipe fallback
        let touchStartX = 0;
        wrap.addEventListener('touchstart', e => {
            touchStartX = e.touches[0].clientX;
        }, { passive: true });

        wrap.addEventListener('touchend', e => {
            const touchEndX = e.changedTouches[0].clientX;
            const diff = touchEndX - touchStartX;
            if (Math.abs(diff) > 40) {
                if (diff < 0) turn(1);
                else turn(-1);
            }
        }, { passive: true });

        // Keyboard arrow navigation
        window.addEventListener('keydown', e => {
            const photoContent = document.getElementById('photography-content');
            if (photoContent && photoContent.classList.contains('active')) {
                if (window.innerWidth > 768 && snapAnimateTo) {
                    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { snapAnimateTo(snapCurrentX - 328, true); e.preventDefault(); }
                    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { snapAnimateTo(snapCurrentX + 328, true); e.preventDefault(); }
                    else if (e.key === 'Home') { snapAnimateTo(0, true); e.preventDefault(); }
                    else if (e.key === 'End') { snapAnimateTo(snapMinX, true); e.preventDefault(); }
                } else {
                    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { turn(1); e.preventDefault(); }
                    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { turn(-1); e.preventDefault(); }
                    else if (e.key === 'Home') { riffleTo(0); e.preventDefault(); }
                    else if (e.key === 'End') { riffleTo(totalLeaves); e.preventDefault(); }
                }
            }
        });

        // Initial setup
        const initial = vo();
        deck.act = initial.act;
        deck.right = initial.right;
        deck.left = initial.left;
        deck.pos = initial.pos;
        paint();
    }

    function initTimelineView() {
        if (window.innerWidth > 768) {
            initSnapGallery();
        } else {
            initMemoryAlbum();
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            initTimelineView();
        });
    } else {
        initTimelineView();
    }

    document.addEventListener('click', function(e) {
        if (e.target.closest('[data-tab="photography"]')) {
            setTimeout(initTimelineView, 80);
        }
        if (e.target.closest('[data-tab="movies"]')) {
            setTimeout(() => {
                if (typeof initVideoWallGallery === 'function') initVideoWallGallery();
            }, 80);
        }
    });

    window.addEventListener('resize', () => {
        initTimelineView();
    });
})();


/* ==========================================================================
   Shader Card Stories (Auto-Playing Visual Slides & WebGL Liquid Shader)
   Exact match to: https://www.framer.com/marketplace/components/shader-card-stories/
   ========================================================================== */
(function() {
    function initShaderCardStories() {
        const cardEl = document.getElementById('shaderCardStories');
        const canvas = document.getElementById('shaderCardCanvas');
        if (!cardEl || !canvas) return;

        const STORIES = [
            {
                seed: 318.0,
                colors: [
                    [11/255, 31/255, 58/255],
                    [29/255, 70/255, 120/255],
                    [57/255, 116/255, 181/255],
                    [120/255, 163/255, 207/255]
                ]
            },
            {
                seed: 573.0,
                // Refined calm emerald spruce green (matches Framer live site)
                colors: [
                    [10/255, 36/255, 30/255],
                    [22/255, 68/255, 54/255],
                    [42/255, 108/255, 84/255],
                    [95/255, 158/255, 134/255]
                ]
            },
            {
                seed: 745.0,
                // Refined dusty plum/wine (matches Framer live site)
                colors: [
                    [36/255, 12/255, 18/255],
                    [78/255, 24/255, 36/255],
                    [138/255, 48/255, 64/255],
                    [186/255, 96/255, 110/255]
                ]
            }
        ];

        let gl = canvas.getContext('webgl2', { alpha: false, antialias: false, powerPreference: 'high-performance' });
        if (!gl) {
            console.warn('WebGL2 not supported, fallback to WebGL1');
            gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
            if (!gl) return;
        }

        const vsSource = `#version 300 es
        in vec2 position;
        out vec2 v_uv;
        void main() {
            v_uv = (position + 1.0) * 0.5;
            gl_Position = vec4(position, 0.0, 1.0);
        }`;

        const fsSource = `#version 300 es
        precision highp float;
        in vec2 v_uv;
        out vec4 fragColor;

        uniform vec2 u_resolution;
        uniform float u_time;
        uniform float u_seedA;
        uniform float u_seedB;
        uniform float u_transition;
        uniform vec3 u_colorsA[4];
        uniform vec3 u_colorsB[4];
        uniform float u_speed;
        uniform float u_turbAmp;
        uniform float u_turbFreq;
        uniform float u_turbIter;
        uniform float u_waveFreq;
        uniform float u_scale;
        uniform float u_contrast;
        uniform float u_saturation;
        uniform vec2 u_mouse;
        uniform float u_mouseHover;

        const float GOLDEN_ANGLE = 2.3999632;
        const float TAU = 6.28318530;

        uvec3 hash3(uvec3 v) {
            v = v * 1664525u + 1013904223u;
            v.x += v.y * v.z;
            v.y += v.z * v.x;
            v.z += v.x * v.y;
            v ^= v >> 16u;
            v.x += v.y * v.z;
            v.y += v.z * v.x;
            v.z += v.x * v.y;
            return v;
        }

        vec3 seedRandom(float seedVal) {
            uvec3 s = uvec3(
                floatBitsToUint(seedVal),
                floatBitsToUint(seedVal * 1.5 + 7.31),
                floatBitsToUint(seedVal * 2.7 + 13.37)
            );
            return vec3(hash3(s)) / float(0xFFFFFFFFu);
        }

        vec3 toLinear(vec3 c) {
            return pow(c, vec3(2.2));
        }

        vec3 toSrgb(vec3 c) {
            return pow(clamp(c, 0.0, 1.0), vec3(0.4545));
        }

        vec3 linearToOklab(vec3 c) {
            float l = 0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b;
            float m = 0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b;
            float s = 0.0883024619 * c.r + 0.2817188376 * c.g + 0.6299787005 * c.b;
            l = pow(max(l, 0.0), 1.0/3.0);
            m = pow(max(m, 0.0), 1.0/3.0);
            s = pow(max(s, 0.0), 1.0/3.0);
            return vec3(
                0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
                1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
                0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s
            );
        }

        vec3 oklabToLinear(vec3 c) {
            float l = c.x + 0.3963377774 * c.y + 0.2158037573 * c.z;
            float m = c.x - 0.1055613458 * c.y - 0.0638541728 * c.z;
            float s = c.x - 0.0894841775 * c.y - 1.2914855480 * c.z;
            l = l * l * l;
            m = m * m * m;
            s = s * s * s;
            return vec3(
                +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
                -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
                -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
            );
        }

        vec3 oklabToLch(vec3 lab) {
            return vec3(lab.x, length(lab.yz), atan(lab.z, lab.y));
        }

        vec3 lchToOklab(vec3 lch) {
            return vec3(lch.x, lch.y * cos(lch.z), lch.y * sin(lch.z));
        }

        vec3 mixLch(vec3 lab0, vec3 lab1, float t) {
            vec3 lch0 = oklabToLch(lab0);
            vec3 lch1 = oklabToLch(lab1);
            if (lch0.y < 0.05) lch0.z = lch1.z;
            if (lch1.y < 0.05) lch1.z = lch0.z;
            float dh = lch1.z - lch0.z;
            if (dh > 3.14159265) dh -= 6.28318530;
            if (dh < -3.14159265) dh += 6.28318530;
            return lchToOklab(vec3(
                mix(lch0.x, lch1.x, t),
                mix(lch0.y, lch1.y, t),
                lch0.z + dh * t
            ));
        }

        vec3 samplePalette(float t, vec3 colors[4]) {
            t = clamp(t, 0.0, 1.0);
            float segment = 1.0 / 3.0;
            int idx = min(int(floor(t / segment)), 2);
            float localT = clamp((t - float(idx) * segment) / segment, 0.0, 1.0);
            
            vec3 c0 = colors[0];
            vec3 c1 = colors[1];
            if (idx == 1) { c0 = colors[1]; c1 = colors[2]; }
            else if (idx == 2) { c0 = colors[2]; c1 = colors[3]; }
            
            vec3 lab0 = linearToOklab(toLinear(c0));
            vec3 lab1 = linearToOklab(toLinear(c1));
            return oklabToLinear(mixLch(lab0, lab1, localT));
        }

        float IGN(vec2 uv) {
            return fract(52.9829189 * fract(dot(uv, vec2(0.06711056, 0.00583715))));
        }

        float evalFluid(vec2 p, float seed, float time) {
            float t = time * 0.3;
            vec3 seedOffset = seedRandom(seed);
            vec3 seedOffset2 = seedRandom(seed + 100.0);
            float seedAngle = seed * GOLDEN_ANGLE;
            vec2 seedPhase = (seedOffset2.xy - 0.5) * TAU;
            
            float cs = cos(seedAngle);
            float sn = sin(seedAngle);
            mat2 rot = mat2(cs, -sn, sn, cs);
            vec2 rp = rot * p;

            float totalVal = 0.0;
            float totalWeight = 0.0;
            int turbIter = int(u_turbIter);
            float freq = 1.0 / max(u_turbFreq, 0.01);
            
            for (float i = 0.0; i < 4.0; i++) {
                float eph = i / 4.0;
                vec2 q = rp * u_scale;
                float a = seedPhase.x;
                float d = seedPhase.y;
                
                for (int j = 2; j < 11; j++) {
                    if (j >= turbIter) break;
                    float fj = float(j);
                    float t1 = t * u_speed;
                    q += u_turbAmp * sin(q.yx / freq * fj + t1 + vec2(a, d) + seedOffset.xy * fj) / fj;
                    a += cos(fj + d * 1.2 + q.x * 2.0 - t1 + seedOffset2.z);
                    d += sin(fj * q.y + a + seedOffset.z + t1 + seedOffset2.y);
                }
                
                float v = 0.5 + 0.5 * sin(length(q.yx + vec2(a, d) * 0.2) * u_waveFreq + i * i + seedOffset.x);
                float weight = smoothstep(0.0, 0.5, eph) * smoothstep(1.0, 0.5, eph);
                totalVal += v * weight;
                totalWeight += weight;
            }
            
            float val = totalVal / max(totalWeight, 0.001);
            return clamp((val - 0.3) / 0.4, 0.0, 1.0);
        }

        void main() {
            vec2 fragCoord = v_uv * u_resolution;
            vec2 r = u_resolution;
            vec2 p = (fragCoord * 2.0 - r) / r.y;

            // Interactive cursor push displacement
            vec2 mouseOffset = (v_uv - u_mouse) * vec2(r.x / r.y, 1.0);
            float mouseDist = length(mouseOffset);
            float pushInfluence = exp(-mouseDist * 3.5) * u_mouseHover;
            p -= mouseOffset * (pushInfluence * 0.3);

            // Evaluate state A
            float valA = evalFluid(p, u_seedA, u_time);
            vec3 colA = samplePalette(valA, u_colorsA);

            // If transitioning, evaluate state B and blend seamlessly
            vec3 col = colA;
            if (u_transition > 0.001) {
                float valB = evalFluid(p, u_seedB, u_time);
                vec3 colB = samplePalette(valB, u_colorsB);
                float easeT = smoothstep(0.0, 1.0, u_transition);
                col = mix(colA, colB, easeT);
            }

            // Apply gentle contrast and saturation
            vec3 lab = linearToOklab(col);
            float C = length(lab.yz) * u_saturation;
            float h = atan(lab.z, lab.y);
            lab.x = clamp((lab.x - 0.5) * u_contrast + 0.5, 0.0, 1.0);
            lab.y = C * cos(h);
            lab.z = C * sin(h);
            col = oklabToLinear(lab);

            // Subtle grain dither
            float dither = IGN(floor(fragCoord));
            col = clamp(col + (dither - 0.5) * 0.02, 0.0, 1.0);

            fragColor = vec4(toSrgb(col), 1.0);
        }`;

        function compileShader(type, src) {
            const s = gl.createShader(type);
            gl.shaderSource(s, src);
            gl.compileShader(s);
            if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
                console.error('Shader compilation error:', gl.getShaderInfoLog(s));
                gl.deleteShader(s);
                return null;
            }
            return s;
        }

        const vs = compileShader(gl.VERTEX_SHADER, vsSource);
        const fs = compileShader(gl.FRAGMENT_SHADER, fsSource);
        if (!vs || !fs) return;

        const program = gl.createProgram();
        gl.attachShader(program, vs);
        gl.attachShader(program, fs);
        gl.linkProgram(program);

        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            console.error('Program link error:', gl.getProgramInfoLog(program));
            return;
        }

        const quadBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
            -1, -1,  1, -1, -1,  1,
            -1,  1,  1, -1,  1,  1
        ]), gl.STATIC_DRAW);

        const posLoc = gl.getAttribLocation(program, 'position');
        const uResLoc = gl.getUniformLocation(program, 'u_resolution');
        const uTimeLoc = gl.getUniformLocation(program, 'u_time');
        const uSeedALoc = gl.getUniformLocation(program, 'u_seedA');
        const uSeedBLoc = gl.getUniformLocation(program, 'u_seedB');
        const uTransLoc = gl.getUniformLocation(program, 'u_transition');
        const uColorsALoc = gl.getUniformLocation(program, 'u_colorsA');
        const uColorsBLoc = gl.getUniformLocation(program, 'u_colorsB');
        const uSpeedLoc = gl.getUniformLocation(program, 'u_speed');
        const uTurbAmpLoc = gl.getUniformLocation(program, 'u_turbAmp');
        const uTurbFreqLoc = gl.getUniformLocation(program, 'u_turbFreq');
        const uTurbIterLoc = gl.getUniformLocation(program, 'u_turbIter');
        const uWaveFreqLoc = gl.getUniformLocation(program, 'u_waveFreq');
        const uScaleLoc = gl.getUniformLocation(program, 'u_scale');
        const uContrastLoc = gl.getUniformLocation(program, 'u_contrast');
        const uSaturationLoc = gl.getUniformLocation(program, 'u_saturation');
        const uMouseLoc = gl.getUniformLocation(program, 'u_mouse');
        const uMouseHoverLoc = gl.getUniformLocation(program, 'u_mouseHover');

        let currentStoryIdx = 0;
        let prevStoryIdx = 0;
        let transitionProgress = 1.0;
        const TRANSITION_DURATION = 900; // ms for crossfade
        let storyProgress = 0;
        const STORY_DURATION = 10000;
        let lastTime = performance.now();
        let isPaused = false;
        let isVisible = false;

        let targetMouse = [0.5, 0.5];
        let currentMouse = [0.5, 0.5];
        let mouseHover = 0.0;
        let targetHover = 0.0;

        cardEl.addEventListener('pointerenter', () => {
            isPaused = true;
            targetHover = 1.0;
        });

        cardEl.addEventListener('pointerleave', () => {
            isPaused = false;
            targetHover = 0.0;
        });

        cardEl.addEventListener('pointermove', (e) => {
            const rect = cardEl.getBoundingClientRect();
            targetMouse[0] = (e.clientX - rect.left) / rect.width;
            targetMouse[1] = 1.0 - (e.clientY - rect.top) / rect.height;
        });

        function setStory(nextIdx) {
            if (nextIdx === currentStoryIdx && transitionProgress >= 1.0) return;
            prevStoryIdx = currentStoryIdx;
            currentStoryIdx = nextIdx;
            transitionProgress = 0.0;
            storyProgress = 0;

            const slides = cardEl.querySelectorAll('.shader-story-slide');
            slides.forEach((s) => {
                const sIdx = parseInt(s.getAttribute('data-story'), 10);
                if (sIdx === currentStoryIdx) {
                    s.classList.remove('exit-up');
                    s.classList.add('active');
                } else if (sIdx === prevStoryIdx) {
                    s.classList.remove('active');
                    s.classList.add('exit-up');
                } else {
                    s.classList.remove('active', 'exit-up');
                }
            });
        }

        window.setShaderStory = setStory;

        const segments = cardEl.querySelectorAll('.shader-progress-segment');
        segments.forEach((seg, i) => {
            seg.addEventListener('click', (e) => {
                e.stopPropagation();
                setStory(i);
            });
        });

        cardEl.addEventListener('click', (e) => {
            if (e.target.closest('.shader-card-action-btn') || e.target.closest('.shader-progress-segment')) return;
            const rect = cardEl.getBoundingClientRect();
            const clickX = e.clientX - rect.left;
            if (clickX < rect.width * 0.35) {
                setStory((currentStoryIdx - 1 + STORIES.length) % STORIES.length);
            } else {
                setStory((currentStoryIdx + 1) % STORIES.length);
            }
        });

        function resize() {
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            const w = cardEl.clientWidth;
            const h = cardEl.clientHeight;
            if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
                canvas.width = Math.round(w * dpr);
                canvas.height = Math.round(h * dpr);
                gl.viewport(0, 0, canvas.width, canvas.height);
            }
        }

        function render(now) {
            if (!isVisible) {
                requestAnimationFrame(render);
                return;
            }

            const dt = Math.min(now - lastTime, 100);
            lastTime = now;

            if (!isPaused) {
                storyProgress += dt;
                if (storyProgress >= STORY_DURATION) {
                    setStory((currentStoryIdx + 1) % STORIES.length);
                }
            }

            if (transitionProgress < 1.0) {
                transitionProgress = Math.min(1.0, transitionProgress + dt / TRANSITION_DURATION);
            }

            const segments = cardEl.querySelectorAll('.shader-progress-segment');
            segments.forEach((seg, i) => {
                const fill = seg.querySelector('.shader-progress-fill');
                if (!fill) return;
                if (i < currentStoryIdx) {
                    fill.style.width = '100%';
                } else if (i === currentStoryIdx) {
                    const pct = Math.min((storyProgress / STORY_DURATION) * 100, 100);
                    fill.style.width = pct + '%';
                } else {
                    fill.style.width = '0%';
                }
            });

            currentMouse[0] += (targetMouse[0] - currentMouse[0]) * 0.08;
            currentMouse[1] += (targetMouse[1] - currentMouse[1]) * 0.08;
            mouseHover += (targetHover - mouseHover) * 0.08;

            resize();

            gl.useProgram(program);
            gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
            gl.enableVertexAttribArray(posLoc);
            gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

            gl.uniform2f(uResLoc, canvas.width, canvas.height);
            gl.uniform1f(uTimeLoc, now * 0.001);
            gl.uniform1f(uSeedALoc, STORIES[prevStoryIdx].seed);
            gl.uniform1f(uSeedBLoc, STORIES[currentStoryIdx].seed);
            gl.uniform1f(uTransLoc, transitionProgress);
            gl.uniform3fv(uColorsALoc, new Float32Array(STORIES[prevStoryIdx].colors.flat()));
            gl.uniform3fv(uColorsBLoc, new Float32Array(STORIES[currentStoryIdx].colors.flat()));

            // Calibrated calm speed & subdued elegant saturation
            gl.uniform1f(uSpeedLoc, 0.10);
            gl.uniform1f(uTurbAmpLoc, 0.38);
            gl.uniform1f(uTurbFreqLoc, 0.1);
            gl.uniform1f(uTurbIterLoc, 7.0);
            gl.uniform1f(uWaveFreqLoc, 3.6);
            gl.uniform1f(uScaleLoc, 0.48);
            gl.uniform1f(uContrastLoc, 1.0);
            gl.uniform1f(uSaturationLoc, 0.88);
            gl.uniform2f(uMouseLoc, currentMouse[0], currentMouse[1]);
            gl.uniform1f(uMouseHoverLoc, mouseHover);

            gl.drawArrays(gl.TRIANGLES, 0, 6);
            requestAnimationFrame(render);
        }

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                isVisible = entry.isIntersecting;
                if (isVisible) {
                    lastTime = performance.now();
                }
            });
        }, { threshold: 0.1 });

        observer.observe(cardEl);
        requestAnimationFrame(render);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initShaderCardStories);
    } else {
        initShaderCardStories();
    }
})();

/* ==========================================================================
   Shader Button (https://framer.com/m/Shader-Button-v12VJe.js@PhehsfTqnG7o5bWDuNUT)
   Liquid Gradient Shader on WebGL2
   ========================================================================== */
/* Pixel Effect Button Engine (Cloned from https://rich-updates-104845.framer.app) */
(function() {
    class Pixel {
        constructor(canvas, ctx, x, y, color, speedMultiplier, delay, maxSizeInteger = 2) {
            this.width = canvas.width;
            this.height = canvas.height;
            this.ctx = ctx;
            this.x = x;
            this.y = y;
            this.color = color;
            this.speed = (Math.random() * 0.8 + 0.1) * speedMultiplier;
            this.size = 0;
            this.sizeStep = Math.random() * 0.4;
            this.minSize = 0.5;
            this.maxSizeInteger = maxSizeInteger;
            this.maxSize = Math.random() * (this.maxSizeInteger - this.minSize) + this.minSize;
            this.delay = delay;
            this.counter = 0;
            this.counterStep = Math.random() * 4 + (this.width + this.height) * 0.01;
            this.isIdle = false;
            this.isReverse = false;
            this.isShimmer = false;
        }

        reset() {
            this.size = 0;
            this.counter = 0;
            this.isIdle = false;
            this.isReverse = false;
            this.isShimmer = false;
        }

        shimmer() {
            if (this.size >= this.maxSize) this.isReverse = true;
            else if (this.size <= this.minSize) this.isReverse = false;
            if (this.isReverse) this.size -= this.speed;
            else this.size += this.speed;
        }

        draw(rippleStart, ripplePos, duration, scale, enableRipple, now, globalAlpha = 1) {
            let rippleBoost = 0;
            if (enableRipple && rippleStart > 0) {
                let elapsed = now - rippleStart;
                let maxDist = duration * 1000;
                if (elapsed <= maxDist + 200) {
                    let travel = elapsed * (Math.max(this.width, this.height) / maxDist);
                    let dx = this.x - ripplePos.x;
                    let dy = this.y - ripplePos.y;
                    let dist = Math.sqrt(dx * dx + dy * dy);
                    let diff = Math.abs(dist - travel);
                    if (diff < 50) {
                        let factor = 1 - diff / 50;
                        let norm = Math.max(0, this.size / this.maxSize);
                        rippleBoost = scale * (factor * factor) * norm;
                    }
                }
            }

            let s = (this.size + rippleBoost) * globalAlpha;
            if (s < 0.1) return;
            let offset = this.maxSizeInteger * 0.5 - s * 0.5;
            this.ctx.fillStyle = this.color;
            this.ctx.fillRect(this.x + offset, this.y + offset, s, s);
        }

        appear(rippleStart, ripplePos, duration, scale, enableRipple, now, globalAlpha = 1) {
            this.isIdle = false;
            if (this.size === 0 && this.counter <= this.delay) {
                this.counter += this.counterStep;
                return;
            }
            if (this.size >= this.maxSize) {
                this.isShimmer = true;
            }
            if (this.isShimmer) {
                this.shimmer();
            } else {
                this.size += this.sizeStep;
            }
            this.draw(rippleStart, ripplePos, duration, scale, enableRipple, now, globalAlpha);
        }

        disappear(rippleStart, ripplePos, duration, scale, enableRipple, now, globalAlpha = 1) {
            this.isShimmer = false;
            this.counter = 0;
            if (this.size <= 0.01) {
                this.isIdle = true;
                this.size = 0;
                return;
            }
            this.size *= 0.92;
            this.draw(rippleStart, ripplePos, duration, scale, enableRipple, now, globalAlpha);
        }
    }

    function initPixelButton() {
        const btn = document.querySelector('.btn-cv-download');
        if (!btn) return;
        const canvas = btn.querySelector('.btn-shader-canvas');
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Settings from Framer Component
        const pixelColors = ['#3b82f6', '#60a5fa', '#93c5fd'];
        const pixelSize = 2;
        const pixelGap = 5;
        const speedMultiplier = 35 * 0.001;
        const rippleSettings = { brightness: 1.5, scale: 3, duration: 0.6 };
        const beamSpeedSeconds = 3;

        let pixels = [];
        let isHovered = false;
        let animState = 'idle';
        let animFrame = null;
        let fadeFrame = null;
        let fadeAlpha = 1;
        let lastFrameTime = performance.now();
        let rippleStartTime = 0;
        let ripplePos = { x: 0, y: 0 };
        let rippleTimeout = null;

        let beamAngle = 0;
        let currentSpread = 5;
        let targetSpread = 5;
        let currentOffset = 0;
        let targetOffset = 0;

        function calcDistance(x, y, w, h) {
            let dx = x - w / 2;
            let dy = y - h / 2;
            return Math.sqrt(dx * dx + dy * dy);
        }

        function initPixels() {
            const rect = btn.getBoundingClientRect();
            const w = Math.floor(rect.width);
            const h = Math.floor(rect.height);
            if (w === 0 || h === 0) return;

            canvas.width = w;
            canvas.height = h;
            pixels = [];

            for (let x = 0; x < w; x += pixelGap) {
                for (let y = 0; y < h; y += pixelGap) {
                    const color = pixelColors[Math.floor(Math.random() * pixelColors.length)];
                    const delay = calcDistance(x, y, w, h);
                    pixels.push(new Pixel(canvas, ctx, x, y, color, speedMultiplier, delay, pixelSize));
                }
            }
        }

        function cancelFade() {
            if (fadeFrame) {
                cancelAnimationFrame(fadeFrame);
                fadeFrame = null;
            }
        }

        function renderPixels() {
            const now = performance.now();
            const delta = now - lastFrameTime;
            const targetDelta = 1000 / 60;

            if (delta < targetDelta) {
                animFrame = requestAnimationFrame(renderPixels);
                return;
            }
            lastFrameTime = now - (delta % targetDelta);

            ctx.clearRect(0, 0, canvas.width, canvas.height);

            for (let i = 0; i < pixels.length; i++) {
                if (animState === 'appear') {
                    pixels[i].appear(rippleStartTime, ripplePos, rippleSettings.duration, rippleSettings.scale, true, now, fadeAlpha);
                } else {
                    pixels[i].disappear(rippleStartTime, ripplePos, rippleSettings.duration, rippleSettings.scale, true, now, fadeAlpha);
                }
            }

            const isRippling = rippleStartTime > 0 && (now - rippleStartTime < rippleSettings.duration * 1000 + 200);
            const allIdle = pixels.every(p => p.isIdle);

            if (animState === 'appear' || isRippling || !allIdle || fadeFrame) {
                animFrame = requestAnimationFrame(renderPixels);
            } else {
                animFrame = null;
                animState = 'idle';
            }
        }

        function setAnimState(newState) {
            if (newState === 'appear') {
                cancelFade();
                fadeAlpha = 1;
                animState = 'appear';
                pixels.forEach(p => { if (p.isIdle) p.reset(); });
            } else if (newState === 'disappear') {
                cancelFade();
                animState = 'disappear';
                const fadeStart = performance.now();
                const startAlpha = fadeAlpha;
                function fadeStep(rNow) {
                    const progress = Math.min((rNow - fadeStart) / 250, 1);
                    fadeAlpha = startAlpha * (1 - (1 - Math.pow(1 - progress, 3)));
                    if (progress < 1) {
                        fadeFrame = requestAnimationFrame(fadeStep);
                    } else {
                        fadeAlpha = 0;
                        fadeFrame = null;
                    }
                }
                fadeFrame = requestAnimationFrame(fadeStep);
            }

            if (!animFrame) {
                animFrame = requestAnimationFrame(renderPixels);
            }
        }

        let lastBeamTime = performance.now();
        function animateBeam(time) {
            const delta = (time - lastBeamTime) * 0.001;
            lastBeamTime = time;

            const speed = isHovered ? 0.5 : 1.0;
            const step = (360 / beamSpeedSeconds) * delta * speed;
            beamAngle = (beamAngle + step) % 360;

            currentSpread += (targetSpread - currentSpread) * 0.15;
            currentOffset += (targetOffset - currentOffset) * 0.15;

            btn.style.setProperty('--beam-angle', beamAngle.toFixed(2) + 'deg');
            btn.style.setProperty('--beam-spread', currentSpread.toFixed(2) + '%');
            btn.style.setProperty('--beam-offset', currentOffset.toFixed(2) + 'deg');

            requestAnimationFrame(animateBeam);
        }
        requestAnimationFrame(animateBeam);

        const resizeObserver = new ResizeObserver(() => {
            initPixels();
        });
        resizeObserver.observe(btn);
        initPixels();

        btn.addEventListener('mouseenter', () => {
            isHovered = true;
            targetSpread = 20;
            targetOffset = 95;
            setAnimState('appear');
        });

        btn.addEventListener('mouseleave', () => {
            isHovered = false;
            targetSpread = 5;
            targetOffset = 0;
            btn.classList.remove('is-rippling');
            setAnimState('disappear');
        });

        btn.addEventListener('pointerdown', (e) => {
            const rect = btn.getBoundingClientRect();
            ripplePos = { x: e.clientX - rect.left, y: e.clientY - rect.top };
            rippleStartTime = performance.now();
            btn.classList.add('is-rippling');

            if (rippleTimeout) clearTimeout(rippleTimeout);
            rippleTimeout = setTimeout(() => {
                btn.classList.remove('is-rippling');
                rippleStartTime = 0;
            }, rippleSettings.duration * 1000 + 300);
        });

        btn.addEventListener('pointerup', () => {
            btn.classList.remove('is-rippling');
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initPixelButton);
    } else {
        initPixelButton();
    }
})();


/* ==========================================================================
   Cancap Text Animation Engine (Section, Subsection & Description)
   Cloned from: https://cancap-text-pack.framer.website/
   (Extracted & merged directly from Framer script_main.BvODmsfE.mjs into JS/CSS)
   ========================================================================== */
(function() {
    function initNextTaxonomyVisuals() {
        // Cancap Text Animation Pack Engine (Section, Subsection & Description)
        // Cloned from: https://cancap-text-pack.framer.website/
        const sectionConfig = [
            { id: 'about', num: '01', sub: 'Executive Summary', title: 'Professional Summary', highlight: 'Summary' },
            { id: 'experience', num: '02', sub: 'Work Experience', title: 'Work Experience', highlight: 'Experience' },
            { id: 'education', num: '03', sub: 'Formal Education', title: 'Academic Education', highlight: 'Education' },
            { id: 'skills', num: '04', sub: 'Technical Stack', title: 'Technical Skills', highlight: 'Skills' },
            { id: 'other-skills', num: '05', sub: 'Key Capabilities', title: 'Applied Competencies', highlight: 'Competencies' },
            { id: 'language-proficiency', num: '06', sub: 'Global Communication', title: 'Language Proficiency', highlight: 'Proficiency' },
            { id: 'core-competencies', num: '07', sub: 'Infrastructure Pillars', title: 'Core Competencies', highlight: 'Competencies' },
            { id: 'projects', num: '08', sub: 'Featured Showcase', title: 'Featured Projects', highlight: 'Projects' },
            { id: 'portfolio', num: '09', sub: 'Beyond the Resume', title: 'Beyond the Resume', highlight: 'Resume' },
            { id: 'about-myself', num: '10', sub: 'Personal Background', title: 'About Myself', highlight: 'Myself' },
            { id: 'clients', num: '11', sub: 'Client Reviews', title: 'From People I’ve Worked With', highlight: 'Worked' },
            { id: 'quote', num: '12', sub: 'Words of Inspiration', title: 'Favorite Quotes', highlight: 'Quotes' }
        ];

        // 1. Setup Section, Subsection and Split Reveal words
        sectionConfig.forEach(item => {
            const section = document.getElementById(item.id);
            if (!section) return;

            let titleEl = section.querySelector('.section-title');
            if (!titleEl && item.id === 'contact') {
                titleEl = section.querySelector('.contact-info h3');
                if (titleEl) {
                    titleEl.classList.add('section-title');
                }
            }
            if (!titleEl) return;

            // Remove legacy taxonomy badge if exists
            const legacyBadge = section.querySelector('.taxonomy-section-badge');
            if (legacyBadge) legacyBadge.remove();

            // Inject Cancap section number eyebrow
            let headerBlock = section.querySelector('.cancap-section-header');
            if (!headerBlock) {
                headerBlock = document.createElement('div');
                headerBlock.className = 'cancap-section-header';
                headerBlock.setAttribute('aria-hidden', 'true');
                titleEl.parentNode.insertBefore(headerBlock, titleEl);
            }
            headerBlock.innerHTML = `
                <div class="cancap-eyebrow">${item.num} / 12</div>
            `;

            // Apply Cancap Split Reveal markup
            const words = item.title.split(' ');
            let wordIdx = 0;
            titleEl.innerHTML = words.map(w => {
                const cleanWord = w.replace(/[^\w]/g, '').toLowerCase();
                const isHighlight = item.highlight && cleanWord === item.highlight.toLowerCase();
                return `
                    <span class="cancap-word-wrap">
                        <span class="cancap-word-mask">
                            <span class="cancap-word${isHighlight ? ' cancap-highlight' : ''}" style="--w-idx: ${wordIdx++};">${w}</span>
                        </span>
                    </span>
                `;
            }).join(' ');

            // Prepare section description for Cancap scroll reveal
            let descEl = section.querySelector('.section-description, .experience-description, .education-description, .skills-description, .other-skills-description, .language-proficiency-description, .core-competencies-description');
            if (!descEl && item.id === 'contact') {
                descEl = section.querySelector('.contact-info > p');
            }

            if (descEl) {
                descEl.classList.add('cancap-description');
            }

            // Hide old redundant badge in clients if present
            if (item.id === 'clients') {
                const oldLoomBadge = section.querySelector('.loom-badge');
                if (oldLoomBadge) oldLoomBadge.style.display = 'none';
            }
        });

        // 2. Wrap any other section-titles
        document.querySelectorAll('.section-title').forEach(title => {
            if (title.offsetParent === null && title.style.display === 'none') return;
            if (!title.querySelector('.cancap-word')) {
                const text = title.textContent.trim();
                if (!text) return;
                const words = text.split(' ');
                let idx = 0;
                title.innerHTML = words.map((w, i) => {
                    const isHighlight = i === words.length - 1;
                    return `
                    <span class="cancap-word-wrap">
                        <span class="cancap-word-mask">
                            <span class="cancap-word${isHighlight ? ' cancap-highlight' : ''}" style="--w-idx: ${idx++};">${w}</span>
                        </span>
                    </span>
                `;
                }).join(' ');
            }
        });

        // 3. Direct IntersectionObserver for Cancap scroll reveal
        const revealObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                const section = entry.target.closest('section') || entry.target.parentElement;
                const words = entry.target.querySelectorAll('.cancap-word');
                const desc = section ? section.querySelector('.cancap-description, .section-description, .experience-description, .education-description, .skills-description, .other-skills-description, .language-proficiency-description, .core-competencies-description') : null;

                if (entry.isIntersecting) {
                    if (section) section.classList.add('cancap-inview');
                    entry.target.classList.add('cancap-inview');
                    words.forEach(w => w.classList.add('revealed'));
                    if (desc) desc.classList.add('revealed');
                } else {
                    const rect = entry.target.getBoundingClientRect();
                    if (rect.top > window.innerHeight) {
                        if (section) section.classList.remove('cancap-inview');
                        entry.target.classList.remove('cancap-inview');
                        words.forEach(w => w.classList.remove('revealed'));
                        if (desc) desc.classList.remove('revealed');
                    }
                }
            });
        }, {
            threshold: 0.12,
            rootMargin: '0px 0px -6% 0px'
        });

        // Directly observe every section-title
        document.querySelectorAll('.section-title').forEach(title => {
            revealObserver.observe(title);

            // Immediate reveal check if visible on load
            const r = title.getBoundingClientRect();
            if (r.top < window.innerHeight * 0.9 && r.bottom > 0) {
                const sec = title.closest('section') || title.parentElement;
                if (sec) sec.classList.add('cancap-inview');
                title.classList.add('cancap-inview');
                title.querySelectorAll('.cancap-word').forEach(w => w.classList.add('revealed'));
                const desc = sec ? sec.querySelector('.cancap-description, .section-description, .experience-description, .education-description, .skills-description, .other-skills-description, .language-proficiency-description, .core-competencies-description') : null;
                if (desc) desc.classList.add('revealed');
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

    /* ==========================================================================
       Hero Social App Icons: Recent.design Click Sound Effect
       Extracted from https://recent.design/app-icons Web Audio synthesizer
       ========================================================================== */
    function initHeroSocialClickSound() {
        let audioCtx = null;
        let clickBuffer = null;
        const soundUrl = 'assets/audio/recent-click.wav';

        function getAudioContext() {
            if (!audioCtx) {
                const AudioCtx = window.AudioContext || window.webkitAudioContext;
                if (AudioCtx) audioCtx = new AudioCtx();
            }
            if (audioCtx && audioCtx.state === 'suspended') {
                audioCtx.resume();
            }
            return audioCtx;
        }

        // Preload WAV audio buffer for instant polyphonic playback
        fetch(soundUrl)
            .then(res => res.arrayBuffer())
            .then(arrayBuf => {
                const ctx = getAudioContext();
                if (ctx) {
                    ctx.decodeAudioData(arrayBuf, decoded => {
                        clickBuffer = decoded;
                    });
                }
            })
            .catch(() => {});

        // Direct Web Audio API synthesizer matching Recent.design 'press' algorithm
        function synthesizeRecentClick(ctx) {
            const t = ctx.currentTime;
            const xo = 1e-4;

            // Layer 1: Bandpass filtered white noise
            const noiseLen = Math.floor(ctx.sampleRate * 0.04);
            const noiseBuf = ctx.createBuffer(1, noiseLen, ctx.sampleRate);
            const d = noiseBuf.getChannelData(0);
            for (let i = 0; i < noiseLen; i++) d[i] = Math.random() * 2 - 1;
            const noise = ctx.createBufferSource();
            noise.buffer = noiseBuf;
            const filter = ctx.createBiquadFilter();
            filter.type = 'bandpass';
            filter.frequency.setValueAtTime(2100, t);
            filter.Q.value = 0.9;
            const noiseGain = ctx.createGain();
            noiseGain.gain.setValueAtTime(0.124, t);
            noiseGain.gain.setTargetAtTime(xo, t, 0.006 / 3);
            noise.connect(filter);
            filter.connect(noiseGain);
            noiseGain.connect(ctx.destination);
            noise.start(t);
            noise.stop(t + 0.04);

            // Layer 2: Triangle transient (520Hz -> 430Hz)
            const osc1 = ctx.createOscillator();
            osc1.type = 'triangle';
            osc1.frequency.setValueAtTime(520, t);
            osc1.frequency.exponentialRampToValueAtTime(430, t + 0.038);
            const gain1 = ctx.createGain();
            gain1.gain.setValueAtTime(0.698, t + 0.001);
            gain1.gain.setTargetAtTime(xo, t + 0.001, 0.038 / 3);
            osc1.connect(gain1);
            gain1.connect(ctx.destination);
            osc1.start(t);
            osc1.stop(t + 0.05);

            // Layer 3: Sine with FM (1220Hz -> 880Hz)
            const osc2 = ctx.createOscillator();
            osc2.type = 'sine';
            osc2.frequency.setValueAtTime(1220, t);
            osc2.frequency.exponentialRampToValueAtTime(880, t + 0.018);
            const fmOsc = ctx.createOscillator();
            fmOsc.type = 'sine';
            fmOsc.frequency.value = 1220 * 0.5;
            const fmGain = ctx.createGain();
            fmGain.gain.value = 35;
            fmOsc.connect(fmGain);
            fmGain.connect(osc2.frequency);
            const gain2 = ctx.createGain();
            gain2.gain.setValueAtTime(0.203, t + 0.001);
            gain2.gain.setTargetAtTime(xo, t + 0.001, 0.018 / 3);
            osc2.connect(gain2);
            gain2.connect(ctx.destination);
            fmOsc.start(t);
            fmOsc.stop(t + 0.035);
            osc2.start(t);
            osc2.stop(t + 0.035);
        }

        function playRecentClick() {
            try {
                const ctx = getAudioContext();
                if (!ctx) return;
                if (clickBuffer) {
                    const src = ctx.createBufferSource();
                    src.buffer = clickBuffer;
                    src.connect(ctx.destination);
                    src.start(0);
                } else {
                    synthesizeRecentClick(ctx);
                }
            } catch (err) {}
        }

        const icons = document.querySelectorAll('.hero-app-icon');
        icons.forEach(icon => {
            if (icon.dataset.clickSoundBound) return;
            icon.dataset.clickSoundBound = 'true';
            icon.addEventListener('pointerdown', (e) => {
                if (e.button === 0) playRecentClick();
            });
            icon.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') playRecentClick();
            });
        });
    }

    /* ==========================================================================
       Hero CTA Buttons ("Know More" & "Hire Me"): Framer Sound-On-Click
       Extracted from https://soundonclick.framer.ai/
       ========================================================================== */
    function initHeroButtonsClickSound() {
        const soundUrl = 'assets/audio/framer-click.mp3';
        let audioCtx = null;
        let clickBuffer = null;

        function getAudioContext() {
            if (!audioCtx) {
                const AudioCtx = window.AudioContext || window.webkitAudioContext;
                if (AudioCtx) audioCtx = new AudioCtx();
            }
            if (audioCtx && audioCtx.state === 'suspended') {
                audioCtx.resume();
            }
            return audioCtx;
        }

        fetch(soundUrl)
            .then(res => res.arrayBuffer())
            .then(buf => {
                const ctx = getAudioContext();
                if (ctx) {
                    ctx.decodeAudioData(buf, decoded => {
                        clickBuffer = decoded;
                    });
                }
            })
            .catch(() => {});

        const audioPool = Array.from({ length: 4 }, () => {
            const a = new Audio(soundUrl);
            a.preload = 'auto';
            return a;
        });
        let poolIdx = 0;

        function playFramerClick() {
            try {
                const ctx = getAudioContext();
                if (ctx && clickBuffer) {
                    const src = ctx.createBufferSource();
                    src.buffer = clickBuffer;
                    src.connect(ctx.destination);
                    src.start(0);
                } else {
                    const audio = audioPool[poolIdx];
                    poolIdx = (poolIdx + 1) % audioPool.length;
                    audio.currentTime = 0;
                    audio.play().catch(() => {});
                }
            } catch (e) {}
        }

        const buttons = document.querySelectorAll('.hero-btn-know-more, .hero-btn-hire-me');
        buttons.forEach(btn => {
            if (btn.dataset.clickSoundBound) return;
            btn.dataset.clickSoundBound = 'true';
            btn.addEventListener('pointerdown', (e) => {
                if (e.button === 0) playFramerClick();
            });
            btn.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') playFramerClick();
            });
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            initNextTaxonomyVisuals();
            initHeroSocialClickSound();
            initHeroButtonsClickSound();
        });
    } else {
        initNextTaxonomyVisuals();
        initHeroSocialClickSound();
        initHeroButtonsClickSound();
    }
})();

/* ==========================================================================
   About Myself Section: Framer "Color Bend" Shader Background
   Reference: https://color-bend.framer.website/
   ========================================================================== */
function initAboutMyselfColorBendBg() {
    const canvas = document.getElementById('aboutMyselfBgCanvas');
    const section = document.getElementById('about-myself');
    if (!canvas || !section) return;
    if (section.dataset.colorBendInitialized) return;
    section.dataset.colorBendInitialized = 'true';

    const gl = canvas.getContext('webgl', {
        alpha: true,
        antialias: false,
        premultipliedAlpha: true,
        powerPreference: 'high-performance'
    });
    if (!gl) return;

    const vsSource = `
        attribute vec2 aPosition;
        varying vec2 vUv;
        void main() {
            vUv = aPosition * 0.5 + 0.5;
            gl_Position = vec4(aPosition, 0.0, 1.0);
        }
    `;

    const fsSource = `
        precision highp float;

        #define MAX_COLORS 8
        #define MAX_BANDS 7

        uniform vec2 uCanvas;
        uniform float uTime;
        uniform float uSpeed;
        uniform vec2 uRot;
        uniform int uColorCount;
        uniform vec3 uColors[MAX_COLORS];
        uniform int uTransparent;
        uniform float uScale;
        uniform float uFrequency;
        uniform float uWarpStrength;
        uniform vec2 uPointer;
        uniform float uMouseInfluence;
        uniform float uParallax;
        uniform float uNoise;
        uniform int uIterations;
        uniform float uIntensity;
        uniform float uBandWidth;
        uniform float uEdgeFade;
        varying vec2 vUv;

        float bandGlow(float v) {
            float k = 14.0 / max(uBandWidth, 0.5);
            float core = exp(-pow(abs(v) * k, 2.8));
            float halo = exp(-abs(v) * 14.0 / max(uBandWidth, 0.5));
            return core + 0.18 * halo;
        }

        void main() {
            float t = uTime * uSpeed;
            vec2 p = vUv * 2.0 - 1.0;
            p += uPointer * uParallax * 0.1;
            vec2 rp = vec2(p.x * uRot.x - p.y * uRot.y, p.x * uRot.y + p.y * uRot.x);
            vec2 q = vec2(rp.x * (uCanvas.x / max(uCanvas.y, 1.0)), rp.y);
            q /= max(uScale, 0.0001);

            float freq = max(uFrequency, 0.05);

            vec2 C = 0.7 * vec2(sin(t * 0.12 + 1.3), cos(t * 0.10 + 0.4));
            float th = t * 0.07 + 0.6;
            vec2 dirV = vec2(cos(th), sin(th));
            vec2 rel = q - C;
            float h = length(rel) - 0.95 * dot(dirV, rel);
            float along = dot(vec2(-dirV.y, dirV.x), rel);
            float grad = length(rel / max(length(rel), 0.001) - 0.95 * dirV);
            float widthNorm = mix(1.0, max(grad, 0.15), 0.75);

            h += 0.12 * sin(q.x * 1.1 * freq + q.y * 0.6 + t * 0.25);
            h += 0.07 * sin(q.y * 1.7 * freq - t * 0.2);
            for (int k = 0; k < 4; k++) {
                float fk = float(k);
                float sgn = 1.0 - 2.0 * mod(fk, 2.0);
                vec2 c = vec2(
                    sin(t * (0.19 + fk * 0.06) + fk * 2.1),
                    cos(t * (0.15 + fk * 0.05) + fk * 1.3)
                ) * (0.7 + 0.3 * sin(fk * 2.7 + t * 0.1));
                vec2 dq = q - c;
                h += sgn * uWarpStrength * 0.22 * exp(-dot(dq, dq) * 2.2);
            }

            vec2 pr = vec2(
                uPointer.x * uRot.x - uPointer.y * uRot.y,
                uPointer.x * uRot.y + uPointer.y * uRot.x
            );
            vec2 qp = vec2(pr.x * (uCanvas.x / max(uCanvas.y, 1.0)), pr.y) / max(uScale, 0.0001);
            vec2 dp = q - qp;
            h += uMouseInfluence * 0.16 * exp(-dot(dp, dp) * 1.8);

            vec3 col = vec3(0.0);
            float cover = 0.0;
            int bands = uIterations + 2;
            float spread = 1.4 + 0.9 * float(bands);

            for (int n = 0; n < MAX_BANDS; n++) {
                if (n >= bands) break;
                float fn = float(n);
                float L = 0.15 + spread * fract(0.618034 * fn + 0.27)
                    + 0.08 * sin(t * 0.21 + fn * 1.9);
                float amp = 0.45 + 0.55 * (0.5 + 0.5 * sin(along * 1.3 + fn * 2.6 - t * 0.35));
                float base = (h - L) * 12.0 * freq / widthNorm;

                if (uColorCount > 0) {
                    for (int i = 0; i < MAX_COLORS; i++) {
                        if (i >= uColorCount) break;
                        float fi = float(i);
                        float v = base + (fi - 0.5 * float(uColorCount - 1)) * 0.42;
                        float w = amp * bandGlow(v);
                        col += uColors[i] * w;
                        cover = max(cover, w);
                    }
                } else {
                    float w = amp * bandGlow(base);
                    col += vec3(w);
                    cover = max(cover, w);
                }
            }

            col += vec3(1.0) * pow(clamp(cover, 0.0, 1.0), 3.5) * 0.9;
            col = clamp(col * uIntensity, 0.0, 1.0);
            col = pow(col, vec3(1.0 / 2.2));

            float fade = 1.0;
            if (uEdgeFade > 0.001) {
                vec2 e = min(vUv, 1.0 - vUv);
                fade = smoothstep(0.0, uEdgeFade, e.x) * smoothstep(0.0, uEdgeFade, e.y);
            }

            if (uNoise > 0.0001) {
                float n = fract(sin(dot(gl_FragCoord.xy + vec2(uTime), vec2(12.9898, 78.233))) * 43758.5453123);
                col = clamp(col + (n - 0.5) * uNoise * (0.3 + 1.4 * col), 0.0, 1.0);
            }

            float alphaBase = clamp(cover * 1.3, 0.0, 1.0);
            float a = uTransparent > 0 ? alphaBase * fade : 1.0;
            if (uTransparent == 0) col *= fade;
            vec3 rgb = (uTransparent > 0) ? col * a : col;
            gl_FragColor = vec4(rgb, a);
        }
    `;

    function compileShader(type, src) {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
            console.error(gl.getShaderInfoLog(s));
            gl.deleteShader(s);
            return null;
        }
        return s;
    }

    const vs = compileShader(gl.VERTEX_SHADER, vsSource);
    const fs = compileShader(gl.FRAGMENT_SHADER, fsSource);
    if (!vs || !fs) return;

    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        console.error(gl.getProgramInfoLog(prog));
        return;
    }
    gl.useProgram(prog);

    const posBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

    const posLoc = gl.getAttribLocation(prog, 'aPosition');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    const getU = name => gl.getUniformLocation(prog, name);
    const uniforms = {
        canvas: getU('uCanvas'),
        time: getU('uTime'),
        speed: getU('uSpeed'),
        rot: getU('uRot'),
        colorCount: getU('uColorCount'),
        colors: getU('uColors'),
        transparent: getU('uTransparent'),
        scale: getU('uScale'),
        frequency: getU('uFrequency'),
        warpStrength: getU('uWarpStrength'),
        pointer: getU('uPointer'),
        mouseInfluence: getU('uMouseInfluence'),
        parallax: getU('uParallax'),
        noise: getU('uNoise'),
        iterations: getU('uIterations'),
        intensity: getU('uIntensity'),
        bandWidth: getU('uBandWidth'),
        edgeFade: getU('uEdgeFade')
    };

    function parseColor(str) {
        if (!str || typeof str !== 'string') return null;
        str = str.trim();
        if (str.startsWith('#')) {
            const hex = str.slice(1);
            if (hex.length === 3) {
                return [parseInt(hex[0]+hex[0],16)/255, parseInt(hex[1]+hex[1],16)/255, parseInt(hex[2]+hex[2],16)/255];
            }
            if (hex.length >= 6) {
                return [parseInt(hex.slice(0,2),16)/255, parseInt(hex.slice(2,4),16)/255, parseInt(hex.slice(4,6),16)/255];
            }
        }
        const rgbMatch = str.match(/^rgba?\(([^)]+)\)$/i);
        if (rgbMatch) {
            const p = rgbMatch[1].split(',').map(v => parseFloat(v));
            if (p.length >= 3) return [p[0]/255, p[1]/255, p[2]/255];
        }
        return null;
    }

    function rgbToHsl([r, g, b]) {
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        let h = 0, s = 0, l = (max + min) / 2;
        if (max !== min) {
            const d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
            else if (max === g) h = ((b - r) / d + 2) * 60;
            else h = ((r - g) / d + 4) * 60;
        }
        return [h, s, l];
    }

    function hslToRgb(h, s, l) {
        const c = (1 - Math.abs(2 * l - 1)) * s;
        const hp = (h % 360 + 360) % 360 / 60;
        const x = c * (1 - Math.abs(hp % 2 - 1));
        let rgb = [0, 0, 0];
        if (hp < 1) rgb = [c, x, 0];
        else if (hp < 2) rgb = [x, c, 0];
        else if (hp < 3) rgb = [0, c, x];
        else if (hp < 4) rgb = [0, x, c];
        else if (hp < 5) rgb = [x, 0, c];
        else rgb = [c, 0, x];
        const m = l - c / 2;
        return [rgb[0] + m, rgb[1] + m, rgb[2] + m];
    }

    function toLinear(c) {
        return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    }

    const colorsArray = new Float32Array(8 * 3);
    const pointer = { x: 0, y: 0 };
    const smoothPointer = { x: 0, y: 0 };
    const startTime = performance.now();
    let lastTime = 0;
    let animId = null;
    let isVisible = true;

    // Parameters matching https://color-bend.framer.website/
    const settings = {
        colors: ['#ff5c7a', '#8a5cff'],
        rotation: 50,
        autoRotate: 0,
        speed: 0.35,
        scale: 1.5,
        frequency: 1.5,
        warpStrength: 2.5,
        iterations: 3,
        intensity: 0.22,
        bandWidth: 14.5,
        hueCycle: 62,
        edgeFade: 0.09,
        mouseInfluence: 0.55,
        parallax: 0.9,
        noise: 0.11
    };

    function resize() {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const w = section.offsetWidth || window.innerWidth;
        const h = section.offsetHeight || 600;
        canvas.width = Math.floor(w * dpr);
        canvas.height = Math.floor(h * dpr);
        gl.viewport(0, 0, canvas.width, canvas.height);
        if (uniforms.canvas) gl.uniform2f(uniforms.canvas, w, h);
    }
    resize();

    window.addEventListener('resize', resize, { passive: true });

    section.addEventListener('pointermove', e => {
        const r = section.getBoundingClientRect();
        pointer.x = ((e.clientX - r.left) / (r.width || 1)) * 2 - 1;
        pointer.y = -(((e.clientY - r.top) / (r.height || 1)) * 2 - 1);
    }, { passive: true });

    function render(now) {
        if (!isVisible) {
            animId = null;
            return;
        }

        const elapsed = (now - startTime) / 1000;
        const dt = Math.max(0, (now - (lastTime || now)) / 1000);
        lastTime = now;

        const isLight = document.documentElement.getAttribute('data-theme') === 'light';
        const transparent = isLight;
        const intensity = isLight ? 0.26 : settings.intensity;

        const hueOffset = (settings.hueCycle || 0) * elapsed;
        const parsedColors = settings.colors.map(parseColor).filter(Boolean).slice(0, 8).map(c => {
            let clr = c;
            if (hueOffset) {
                const [h, s, l] = rgbToHsl(clr);
                clr = hslToRgb(h + hueOffset, s, l);
            }
            return [toLinear(clr[0]), toLinear(clr[1]), toLinear(clr[2])];
        });

        colorsArray.fill(0);
        parsedColors.forEach((c, idx) => colorsArray.set(c, idx * 3));

        const rotAngle = ((settings.rotation % 360) + (settings.autoRotate || 0) * elapsed) * Math.PI / 180;
        const easeFactor = Math.min(1, dt * 8);
        smoothPointer.x += (pointer.x - smoothPointer.x) * easeFactor;
        smoothPointer.y += (pointer.y - smoothPointer.y) * easeFactor;

        gl.uniform1f(uniforms.time, elapsed);
        gl.uniform1f(uniforms.speed, settings.speed);
        gl.uniform2f(uniforms.rot, Math.cos(rotAngle), Math.sin(rotAngle));
        gl.uniform1i(uniforms.colorCount, parsedColors.length);
        gl.uniform3fv(uniforms.colors, colorsArray);
        gl.uniform1i(uniforms.transparent, transparent ? 1 : 0);
        gl.uniform1f(uniforms.scale, settings.scale);
        gl.uniform1f(uniforms.frequency, settings.frequency);
        gl.uniform1f(uniforms.warpStrength, settings.warpStrength);
        gl.uniform2f(uniforms.pointer, smoothPointer.x, smoothPointer.y);
        gl.uniform1f(uniforms.mouseInfluence, settings.mouseInfluence);
        gl.uniform1f(uniforms.parallax, settings.parallax);
        gl.uniform1f(uniforms.noise, settings.noise);
        gl.uniform1i(uniforms.iterations, settings.iterations);
        gl.uniform1f(uniforms.intensity, intensity);
        gl.uniform1f(uniforms.bandWidth, settings.bandWidth);
        gl.uniform1f(uniforms.edgeFade, settings.edgeFade);

        gl.clearColor(0.02, 0.03, 0.09, transparent ? 0.0 : 1.0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawArrays(gl.TRIANGLES, 0, 3);

        animId = requestAnimationFrame(render);
    }

    // Optimization: Pause when out of view
    const observer = new IntersectionObserver(entries => {
        entries.forEach(entry => {
            isVisible = entry.isIntersecting;
            if (isVisible && !animId) {
                lastTime = performance.now();
                animId = requestAnimationFrame(render);
            }
        });
    }, { threshold: 0.05 });
    observer.observe(section);

    animId = requestAnimationFrame(render);
}

/* ==========================================================================
   About Myself Text Animate Component (blurInUp word-by-word reveal)
   Reference: https://text-animate.framer.website/showcase
   ========================================================================== */
function initAboutMyselfTextAnimate() {
    const section = document.getElementById('about-myself');
    if (!section) return;
    const content = section.querySelector('.about-myself__content');
    if (!content || content.dataset.textAnimateInit) return;
    content.dataset.textAnimateInit = 'true';

    // Wrap plain words with Text Animate blurInUp markup and sequential stagger indexes
    function wrapParagraphWords(pEl, startIndex) {
        if (!pEl) return startIndex;
        const text = pEl.textContent.trim().replace(/\s+/g, ' ');
        if (!text) return startIndex;
        const words = text.split(' ');
        pEl.innerHTML = words.map((w, i) => {
            return `<span class="ta-word" style="--w-idx: ${startIndex + i};">${w}</span>`;
        }).join(' ');
        return startIndex + words.length;
    }

    // Wrap desktop paragraph
    const desktopP = content.querySelector('p.desktop-only');
    if (desktopP) {
        wrapParagraphWords(desktopP, 0);
    }

    // Wrap mobile paragraphs in a continuous sequence
    const mobileP1 = content.querySelector('p.mobile-only1');
    const mobileP2 = content.querySelector('p.mobile-only2');
    if (mobileP1) {
        const nextIdx = wrapParagraphWords(mobileP1, 0);
        if (mobileP2) {
            wrapParagraphWords(mobileP2, nextIdx);
        }
    } else {
        content.querySelectorAll('p:not(.desktop-only)').forEach(p => wrapParagraphWords(p, 0));
    }

    // Viewport intersection observer to trigger the blurInUp animation
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                content.classList.add('ta-inview');
            } else {
                const rect = entry.target.getBoundingClientRect();
                if (rect.top > window.innerHeight) {
                    content.classList.remove('ta-inview');
                }
            }
        });
    }, {
        threshold: 0.15,
        rootMargin: '0px 0px -5% 0px'
    });

    observer.observe(section);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        initAboutMyselfColorBendBg();
        initAboutMyselfTextAnimate();
    });
} else {
    initAboutMyselfColorBendBg();
    initAboutMyselfTextAnimate();
}


/* ==========================================================================
   Testimonial Swipe Projects Deck Engine
   Reference: https://testimonialswipe.framer.website/
   ========================================================================== */
(function() {
    function initProjectsSwipeDeck() {
        const stage = document.getElementById('projectDeckStage');
        const deckCol = document.getElementById('tsDeckCol');
        if (!stage || !deckCol || stage.dataset.initialized) return;
        stage.dataset.initialized = 'true';

        const currIdxEl = document.getElementById('tsCurrIdx');
        const totalCountEl = document.getElementById('tsTotalCount');
        const headlineEl = document.getElementById('tsHeadline');
        const quoteEl = document.getElementById('tsQuote');
        const authorNameEl = document.getElementById('tsAuthorName');
        const authorRoleEl = document.getElementById('tsAuthorRole');
        const linkEl = document.getElementById('tsLink');
        const prevBtn = document.getElementById('tsPrevBtn');
        const nextBtn = document.getElementById('tsNextBtn');
        const ringFill = document.getElementById('tsRingFill');

        const PROJECTS = [
            {
                badge: "Network Architecture",
                title: "Enterprise Core Network Redesign",
                tag: "Cisco IOS · VLAN Routing · Firewalls",
                headline: "Enterprise Core Network Redesign & Zero-Downtime Deployment",
                quote: "“Complete overhaul of corporate routing, switching, and firewall architecture with multi-VLAN segmentation and redundant gateway failover.”",
                author: "Robin Hossain",
                role: "Network Architecture & Infrastructure Lead",
                link: "#",
                image: "https://images.pexels.com/photos/1181675/pexels-photo-1181675.jpeg?w=800&h=1000&fit=crop"
            },
            {
                badge: "Cybersecurity",
                title: "Full-Spectrum Vulnerability Audit",
                tag: "Pen Testing · ISO 27001 · Threat Hunting",
                headline: "Full-Spectrum Vulnerability Audit & Defense Hardening",
                quote: "“End-to-end security audit and penetration testing across organizational IT infrastructure, remediating critical attack vectors and ensuring policy compliance.”",
                author: "Robin Hossain",
                role: "Cybersecurity Analyst & Penetration Tester",
                link: "#",
                image: "https://images.pexels.com/photos/60504/security-protection-anti-virus-software-60504.jpeg?w=800&h=1000&fit=crop"
            },
            {
                badge: "Operations & DevOps",
                title: "Automated Data Center Monitoring",
                tag: "Prometheus · Grafana · Telemetry",
                headline: "Automated Data Center Monitoring & Incident Alerting",
                quote: "“Engineered a unified real-time observability pipeline tracking temperature, power efficiency, and rack server health with zero missed anomalies.”",
                author: "Robin Hossain",
                role: "Systems Administrator & DevOps Engineer",
                link: "#",
                image: "https://images.pexels.com/photos/325229/pexels-photo-325229.jpeg?w=800&h=1000&fit=crop"
            },
            {
                badge: "Cloud Infrastructure",
                title: "Hybrid Cloud Migration & Containers",
                tag: "Docker · VMware · Hybrid Cloud",
                headline: "Hybrid Cloud Migration & Containerized Workloads",
                quote: "“Transitioned legacy on-premise application servers into a scalable hybrid cloud architecture, cutting provisioning overhead by 65%.”",
                author: "Robin Hossain",
                role: "Cloud Solutions & Systems Architect",
                link: "#",
                image: "https://images.pexels.com/photos/1181354/pexels-photo-1181354.jpeg?w=800&h=1000&fit=crop"
            },
            {
                badge: "Security & Access",
                title: "Zero-Trust Remote Workforce VPN",
                tag: "Zero-Trust · IPsec VPN · MFA Security",
                headline: "Zero-Trust Remote Workforce & IPsec Mesh VPN",
                quote: "“Architected encrypted zero-trust gateways with multi-factor authentication, ensuring seamless and protected connectivity for distributed operations.”",
                author: "Robin Hossain",
                role: "Information Security Specialist",
                link: "#",
                image: "https://images.pexels.com/photos/3861969/pexels-photo-3861969.jpeg?w=800&h=1000&fit=crop"
            }
        ];

        const count = PROJECTS.length;
        if (totalCountEl) totalCountEl.textContent = `/ 0${count}`;

        let order = Array.from({ length: count }, (_, i) => i);
        let isFlying = false;
        let isPaused = false;
        let isIntersecting = false;
        let autoplayTimer = null;
        let animStart = null;
        const AUTOPLAY_DURATION = 6000;
        const CIRCLE_CIRCUMFERENCE = 295.3;

        function getStackTransform(depthIndex) {
            if (depthIndex <= 0) return { x: 0, y: 0, r: 0, s: 1, o: 1 };
            const tilt = 5;
            const spread = 28;
            const maxDepth = 3;
            const side = depthIndex % 2 === 1 ? 1 : -1;
            const tier = Math.ceil(depthIndex / 2);
            return {
                x: side * spread * tier,
                y: spread * 0.22 * tier,
                r: side * tilt * tier,
                s: 1 - 0.045 * depthIndex,
                o: depthIndex <= maxDepth ? 1 : 0
            };
        }

        deckCol.innerHTML = '';
        const cardElements = PROJECTS.map((p, idx) => {
            const card = document.createElement('div');
            card.className = 'ts-card';
            card.dataset.index = idx;
            card.innerHTML = `
                <div class="ts-card-inner">
                    <img class="ts-card-img" src="${p.image}" alt="${p.title}" draggable="false" loading="lazy" />
                    <div class="ts-card-scrim"></div>
                    <div class="ts-card-badge">${p.badge}</div>
                    <div class="ts-card-footer">
                        <div class="ts-card-title">${p.title}</div>
                        <div class="ts-card-tag">${p.tag}</div>
                    </div>
                </div>
            `;
            deckCol.appendChild(card);
            return card;
        });

        function updateDeck(immediate = false) {
            const topIdx = order[0];
            const project = PROJECTS[topIdx];

            if (currIdxEl) currIdxEl.textContent = `0${topIdx + 1}`;
            
            [headlineEl, quoteEl].forEach(el => {
                if (el) {
                    el.classList.remove('ts-rise');
                    void el.offsetWidth;
                    el.classList.add('ts-rise');
                }
            });

            if (headlineEl) headlineEl.textContent = project.headline;
            if (quoteEl) quoteEl.textContent = project.quote;
            if (authorNameEl) authorNameEl.textContent = project.author;
            if (authorRoleEl) authorRoleEl.textContent = project.role;
            if (linkEl) linkEl.href = project.link;

            order.forEach((projIdx, depth) => {
                const card = cardElements[projIdx];
                const stack = getStackTransform(depth);

                card.style.transition = immediate ? 'none' : 'transform 640ms cubic-bezier(0.22, 1, 0.36, 1), opacity 420ms ease';
                card.style.transform = `translate3d(${stack.x}px, ${stack.y}px, 0) rotate(${stack.r}deg) scale(${stack.s})`;
                card.style.opacity = stack.o;
                card.style.zIndex = 100 - depth;
                card.style.pointerEvents = depth === 0 ? 'auto' : 'none';
            });
        }

        function launch(dir = -1) {
            if (isFlying || order.length < 2) return;
            isFlying = true;
            resetAutoplayRing();

            const topIdx = order[0];
            const topCard = cardElements[topIdx];
            const flightDuration = 550;

            topCard.style.transition = `transform ${flightDuration}ms cubic-bezier(0.32, 0.72, 0.24, 1), opacity ${flightDuration * 0.85}ms ease`;
            topCard.style.transform = `translate3d(${dir * 460}px, -24px, 0) rotate(${dir * 14}deg)`;
            topCard.style.opacity = '0';
            topCard.style.zIndex = '200';

            setTimeout(() => {
                const [first, ...rest] = order;
                order = [...rest, first];
                topCard.style.transition = 'none';
                topCard.style.transform = '';
                topCard.style.opacity = '';
                isFlying = false;
                updateDeck();
                startAutoplay();
            }, flightDuration + 50);
        }

        function advance() {
            if (isFlying || order.length < 2) return;
            resetAutoplayRing();
            const [first, ...rest] = order;
            order = [...rest, first];
            updateDeck();
            startAutoplay();
        }

        function rewind() {
            if (isFlying || order.length < 2) return;
            resetAutoplayRing();
            const last = order[order.length - 1];
            order = [last, ...order.slice(0, -1)];
            updateDeck();
            startAutoplay();
        }

        // Pointer drag gestures
        let drag = null;

        deckCol.addEventListener('pointerdown', (e) => {
            if (isFlying || e.button !== 0) return;
            const topIdx = order[0];
            const topCard = cardElements[topIdx];
            if (!topCard || !topCard.contains(e.target)) return;

            try { topCard.setPointerCapture(e.pointerId); } catch (_) {}
            topCard.classList.add('grabbing');
            drag = {
                card: topCard,
                id: e.pointerId,
                startX: e.clientX,
                startY: e.clientY,
                dx: 0,
                dy: 0,
                lastX: e.clientX,
                lastT: performance.now(),
                vx: 0
            };
            topCard.style.transition = 'none';
            isPaused = true;
        });

        window.addEventListener('pointermove', (e) => {
            if (!drag || drag.id !== e.pointerId) return;
            const now = performance.now();
            const dt = Math.max(1, now - drag.lastT);
            drag.vx = drag.vx * 0.6 + ((e.clientX - drag.lastX) / dt) * 0.4;
            drag.lastX = e.clientX;
            drag.lastT = now;
            drag.dx = e.clientX - drag.startX;
            drag.dy = e.clientY - drag.startY;

            drag.card.style.transform = `translate3d(${drag.dx}px, ${drag.dy * 0.3}px, 0) rotate(${drag.dx * 0.045}deg)`;
        });

        const onPointerEnd = (e) => {
            if (!drag || drag.id !== e.pointerId) return;
            const { card, dx, vx } = drag;
            card.classList.remove('grabbing');
            drag = null;

            if (dx < -75 || (vx < -0.5 && dx < -20)) {
                advance();
            } else if (dx > 75 || (vx > 0.5 && dx > 20)) {
                rewind();
            } else {
                card.style.transition = 'transform 520ms cubic-bezier(0.34, 1.4, 0.5, 1)';
                card.style.transform = 'translate3d(0, 0, 0) rotate(0deg)';
                isPaused = false;
            }
        };

        window.addEventListener('pointerup', onPointerEnd);
        window.addEventListener('pointercancel', onPointerEnd);

        if (nextBtn) nextBtn.addEventListener('click', () => advance());
        if (prevBtn) prevBtn.addEventListener('click', () => rewind());

        stage.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowRight') {
                e.preventDefault();
                advance();
            } else if (e.key === 'ArrowLeft') {
                e.preventDefault();
                rewind();
            }
        });

        function resetAutoplayRing() {
            if (ringFill) ringFill.style.strokeDashoffset = CIRCLE_CIRCUMFERENCE;
            if (autoplayTimer) cancelAnimationFrame(autoplayTimer);
            animStart = null;
        }

        function tickAutoplay(timestamp) {
            if (!isIntersecting) return;
            if (isPaused) {
                autoplayTimer = requestAnimationFrame(tickAutoplay);
                return;
            }
            if (!animStart) animStart = timestamp;
            const progress = (timestamp - animStart) / AUTOPLAY_DURATION;

            if (progress >= 1) {
                resetAutoplayRing();
                advance();
            } else {
                const offset = CIRCLE_CIRCUMFERENCE * (1 - progress);
                if (ringFill) ringFill.style.strokeDashoffset = offset;
                autoplayTimer = requestAnimationFrame(tickAutoplay);
            }
        }

        function startAutoplay() {
            resetAutoplayRing();
            if (!isIntersecting) return;
            animStart = performance.now();
            autoplayTimer = requestAnimationFrame(tickAutoplay);
        }

        stage.addEventListener('pointerenter', () => { isPaused = true; });
        stage.addEventListener('pointerleave', () => { isPaused = false; });

        // Observe section intersection to conserve resources
        if (typeof IntersectionObserver !== 'undefined') {
            const obs = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    isIntersecting = entry.isIntersecting;
                    if (isIntersecting) {
                        startAutoplay();
                    } else {
                        resetAutoplayRing();
                    }
                });
            }, { threshold: 0.1 });
            obs.observe(stage);
        } else {
            isIntersecting = true;
            startAutoplay();
        }

        updateDeck(true);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initProjectsSwipeDeck);
    } else {
        initProjectsSwipeDeck();
    }
})();


/* ==========================================================================
   ModernMilestones Timeline Engine
   Reference: https://modernmilestones.framer.website/
   ========================================================================== */
(function() {
    function initModernMilestones() {
        const container = document.getElementById('experienceMilestones');
        if (!container || container.dataset.initialized) return;
        container.dataset.initialized = 'true';

        const progressLine = document.getElementById('mmProgressLine');
        const dots = Array.from(container.querySelectorAll('.mm-node-dot'));
        const trackLine = container.querySelector('.mm-track-line');

        function updateProgress() {
            const rect = container.getBoundingClientRect();
            const windowHeight = window.innerHeight;
            
            // Start filling when container enters 75% down screen, finish when bottom reaches 35%
            const startY = windowHeight * 0.70;
            const endY = windowHeight * 0.30;
            
            const totalDist = rect.height + (startY - endY);
            const currentDist = startY - rect.top;
            
            let progress = currentDist / totalDist;
            progress = Math.max(0, Math.min(1, progress));

            if (progressLine) {
                progressLine.style.transform = `scaleY(${progress})`;
            }

            // Check each milestone dot against line progress
            if (trackLine) {
                const lineRect = trackLine.getBoundingClientRect();
                const currentLineY = lineRect.top + (lineRect.height * progress);

                dots.forEach((dot) => {
                    const dotRect = dot.getBoundingClientRect();
                    const dotCenterY = dotRect.top + dotRect.height / 2;
                    if (currentLineY >= dotCenterY - 4) {
                        dot.classList.add('active');
                    } else {
                        dot.classList.remove('active');
                    }
                });
            }
        }

        window.addEventListener('scroll', updateProgress, { passive: true });
        window.addEventListener('resize', updateProgress, { passive: true });
        // Initial check
        updateProgress();
        setTimeout(updateProgress, 300);
        setTimeout(updateProgress, 1000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initModernMilestones);
    } else {
        initModernMilestones();
    }
})();




(function() {
    /* ==========================================================================
       TESTIMONIAL LOOM CONTROLLER (Framer Testimonial Loom Architecture)
       ========================================================================== */
    function initTestimonialLoom() {
        const stage = document.getElementById('loomStage');
        if (!stage || stage.dataset.initialized) return;
        stage.dataset.initialized = 'true';

        const entries = [
            {
                quote: "Handoff used to be a week of back-and-forth. Now the file lands, the client scrolls it once, and we approve on the same call.",
                author: "Priya Raghunathan",
                role: "Studio Director, Northlight",
                initials: "PR",
                tint: "#FFD9B8",
                photo: "assets/img/clients/priya_raghunathan.png"
            },
            {
                quote: "Nothing broke when we swapped in real content. Long names, missing photos, quotes twice the length. It just held its shape.",
                author: "Tobias Renner",
                role: "Product Designer, Kelder",
                initials: "TR",
                tint: "#CFE3FF",
                photo: "assets/img/clients/tobias_renner.jpg"
            },
            {
                quote: "Marketing updates the section themselves now, and I never hear about it again. That alone was worth it.",
                author: "Amara Sowande",
                role: "Head of Marketing, Bluewick",
                initials: "AS",
                tint: "#D6F0D8",
                photo: "assets/img/clients/amara_sowande.jpg"
            },
            {
                quote: "Bought it on a Thursday, live by Monday. Most of that weekend went on choosing colours rather than fixing anything.",
                author: "Marcus Delaine",
                role: "Founder, Ridgeway Supply",
                initials: "MD",
                tint: "#F3D6F0",
                photo: "assets/img/clients/marcus_delaine.jpg"
            },
            {
                quote: "It is the small things, like how it settles and moves. Clients notice even when they cannot name it.",
                author: "Sofia Marchetti",
                role: "Art Director, Corvo Studio",
                initials: "SM",
                tint: "#FFF0B8",
                photo: "assets/img/clients/sofia_marchetti.jpg"
            }
        ];

        let activeIndex = 0;
        const total = entries.length;
        const holdTime = 7000;
        let autoTimer = null;
        let isHovered = false;

        const bubble = document.getElementById('loomBubble');
        const quoteEl = document.getElementById('loomQuote');
        const authorNameEl = document.getElementById('loomAuthorName');
        const authorRoleEl = document.getElementById('loomAuthorRole');
        const counterEl = document.getElementById('loomCounter');
        const metaEl = document.getElementById('loomMeta');
        const prevBtn = document.getElementById('loomPrevBtn');
        const nextBtn = document.getElementById('loomNextBtn');
        const personBtns = Array.from(stage.querySelectorAll('.loom-person'));
        const driftEls = personBtns.map(btn => btn.querySelector('.loom-drift'));

        // Framer Math Solver for Layout and Positions
        function clamp(v, min, max) {
            return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : min;
        }

        function fo(e, t) {
            let n = Math.sin(e * 12.9898 + t * 78.233) * 43758.5453;
            return n - Math.floor(n);
        }

        function calculateLayout(stageW, stageH) {
            const breakpoint = 760;
            const narrow = stageW < breakpoint;
            const avatarSize = 64;
            const focusSize = 132;
            const s = focusSize * (narrow ? 0.72 : 1);
            const bubbleWidthSetting = 560;
            const c = Math.min(clamp(bubbleWidthSetting, 280, 900), narrow ? stageW - 32 : stageW * 0.62);
            const l = (stageW - (narrow ? c : s + 22 + c)) / 2;
            
            const u = narrow ? { x: stageW / 2, y: stageH * 0.26, s: s } : { x: l + s / 2, y: stageH / 2, s: s };
            const d = narrow ? (stageW - c) / 2 : l + s + 22;
            const f = narrow ? u.y + s / 2 + 18 : stageH / 2;

            const homes = [];
            for (let r = 0; r < total; r++) {
                let angle = (r + 0.5) / total * Math.PI * 2 - Math.PI / 2 + (fo(r, 1) - 0.5) * 0.35;
                let rx = stageW / 2 - avatarSize * 0.9;
                let ry = stageH / 2 - avatarSize * 0.9;
                let scale = 0.86 + fo(r, 2) * 0.14;
                let ux = stageW / 2 + Math.cos(angle) * rx * scale;
                let uy = stageH / 2 + Math.sin(angle) * ry * scale;
                let fSize = avatarSize * (narrow ? 0.72 + fo(r, 4) * 0.2 : 0.78 + fo(r, 4) * 0.4);

                if (narrow) {
                    let isOdd = r % 2;
                    let col = Math.floor(r / 2);
                    let numCols = isOdd ? Math.floor(total / 2) : Math.ceil(total / 2);
                    ux = (col + 0.5) / Math.max(1, numCols) * stageW;
                    uy = isOdd ? stageH - avatarSize * 0.75 - (col % 2) * avatarSize * 0.25 : avatarSize * 0.75 + (col % 2) * avatarSize * 0.25;
                }

                homes.push({
                    x: clamp(ux, fSize / 2 + 6, stageW - fSize / 2 - 6),
                    y: clamp(uy, fSize / 2 + 6, stageH - fSize / 2 - 6),
                    s: fSize
                });
            }

            return { narrow, focus: u, bubbleX: d, bubbleY: f, bubbleW: c, homes };
        }

        let currentLayout = null;

        function applyPositions(animate = true) {
            const stageW = stage.clientWidth || 1000;
            const stageH = stage.clientHeight || 580;
            currentLayout = calculateLayout(stageW, stageH);

            const S = currentLayout;

            // Apply positions to each person
            personBtns.forEach((btn, idx) => {
                const isActive = (idx === activeIndex);
                const target = isActive ? S.focus : S.homes[idx];

                if (!animate) {
                    btn.style.transition = 'none';
                } else {
                    btn.style.transition = 'transform 1s cubic-bezier(.2,.9,.2,1), width 1s cubic-bezier(.2,.9,.2,1), height 1s cubic-bezier(.2,.9,.2,1), opacity .5s ease';
                }

                btn.setAttribute('data-on', isActive ? '1' : '0');
                btn.setAttribute('aria-label', isActive ? `${entries[idx].author}, speaking now` : `Hear from ${entries[idx].author}`);
                btn.setAttribute('aria-current', isActive ? 'true' : 'false');
                btn.style.width = target.s.toFixed(1) + 'px';
                btn.style.height = target.s.toFixed(1) + 'px';
                btn.style.transform = `translate3d(${(target.x - target.s / 2).toFixed(1)}px, ${(target.y - target.s / 2).toFixed(1)}px, 0)`;
                btn.style.zIndex = isActive ? '5' : '2';

                // Manage SVG Countdown Ring on active avatar
                let ringSvg = btn.querySelector('.loom-ringsvg');
                if (isActive) {
                    if (!ringSvg) {
                        ringSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                        ringSvg.setAttribute('class', 'loom-ringsvg');
                        ringSvg.setAttribute('viewBox', '0 0 36 36');
                        ringSvg.setAttribute('aria-hidden', 'true');
                        ringSvg.innerHTML = '<circle cx="18" cy="18" r="16" fill="none" class="loom-ring-bg"></circle><circle class="loom-prog" cx="18" cy="18" r="16" fill="none" pathLength="100"></circle>';
                        btn.querySelector('.loom-drift').appendChild(ringSvg);
                    }
                    const prog = ringSvg.querySelector('.loom-prog');
                    if (prog) {
                        prog.style.animation = 'none';
                        void prog.offsetWidth;
                        prog.style.animation = '';
                    }
                } else {
                    if (ringSvg) {
                        ringSvg.remove();
                    }
                }
            });

            // Position Bubble Card
            bubble.setAttribute('data-narrow', S.narrow ? '1' : '0');
            bubble.style.left = S.bubbleX.toFixed(1) + 'px';
            bubble.style.top = S.bubbleY.toFixed(1) + 'px';
            bubble.style.width = S.bubbleW.toFixed(1) + 'px';
            bubble.style.setProperty('--ox', S.narrow ? '50%' : '0%');
            bubble.style.setProperty('--oy', S.narrow ? '0%' : '50%');
            bubble.style.transform = S.narrow ? 'none' : 'translateY(-50%)';
        }

        function escapeHtml(str) {
            return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        }

        function renderSlideContent(index, triggerPop = true) {
            const data = entries[index];

            // 1. Cascading word reveal
            const words = data.quote.split(' ');
            quoteEl.innerHTML = words.map((w, i) => `<span class="loom-w" style="--i: ${i};">${escapeHtml(w)}</span>`).join(' ');

            // 2. Author and Role
            authorNameEl.textContent = data.author;
            authorRoleEl.textContent = data.role;
            counterEl.textContent = `0${index + 1} / 0${total}`;

            // 3. Elastic Pop on Card
            if (triggerPop) {
                bubble.style.animation = 'none';
                void bubble.offsetWidth;
                bubble.style.animation = '';

                metaEl.style.animation = 'none';
                void metaEl.offsetWidth;
                metaEl.style.animation = '';
            }
        }

        function setSlide(newIndex) {
            if (newIndex === activeIndex) return;
            activeIndex = ((newIndex % total) + total) % total;

            applyPositions(true);
            renderSlideContent(activeIndex, true);
            resetAutoTimer();
        }

        // Automatic timer advance
        function resetAutoTimer() {
            clearTimeout(autoTimer);
            if (!isHovered) {
                autoTimer = setTimeout(() => {
                    setSlide(activeIndex + 1);
                }, holdTime);
            }
        }

        // Floating drift animation loop for inactive avatars
        let driftAnimId = 0;
        let driftStart = performance.now();

        function driftLoop(now) {
            driftAnimId = 0;
            const elapsed = (now - driftStart) / 1000;
            const driftAmount = 8;
            const driftSpeed = 0.5;
            const i = elapsed * driftSpeed;

            for (let r = 0; r < total; r++) {
                const driftEl = driftEls[r];
                if (!driftEl) continue;

                if (r === activeIndex) {
                    driftEl.style.transform = 'none';
                } else {
                    const angle1 = fo(r, 5) * Math.PI * 2;
                    const angle2 = fo(r, 6) * Math.PI * 2;
                    const ox = Math.sin(i * (0.7 + fo(r, 7) * 0.6) + angle1) * driftAmount;
                    const oy = Math.cos(i * (0.6 + fo(r, 8) * 0.5) + angle2) * driftAmount;
                    driftEl.style.transform = `translate3d(${ox.toFixed(2)}px, ${oy.toFixed(2)}px, 0)`;
                }
            }

            driftAnimId = requestAnimationFrame(driftLoop);
        }

        // Event Listeners
        personBtns.forEach((btn, idx) => {
            btn.addEventListener('click', () => {
                setSlide(idx);
            });
        });

        if (prevBtn) {
            prevBtn.addEventListener('click', (e) => {
                e.preventDefault();
                setSlide(activeIndex - 1);
            });
        }

        if (nextBtn) {
            nextBtn.addEventListener('click', (e) => {
                e.preventDefault();
                setSlide(activeIndex + 1);
            });
        }

        // Pause countdown on hover
        stage.addEventListener('mouseenter', () => {
            isHovered = true;
            clearTimeout(autoTimer);
        });

        stage.addEventListener('mouseleave', () => {
            isHovered = false;
            resetAutoTimer();
        });

        // Keyboard arrow navigation
        stage.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                e.preventDefault();
                setSlide(activeIndex + 1);
            } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                e.preventDefault();
                setSlide(activeIndex - 1);
            }
        });

        // ResizeObserver
        if (window.ResizeObserver) {
            const ro = new ResizeObserver(() => {
                applyPositions(false);
            });
            ro.observe(stage);
        } else {
            window.addEventListener('resize', () => {
                applyPositions(false);
            });
        }

        // Initial setup
        applyPositions(false);
        renderSlideContent(0, false);
        resetAutoTimer();
        driftAnimId = requestAnimationFrame(driftLoop);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initTestimonialLoom);
    } else {
        initTestimonialLoom();
    }
})();

// ==========================================================================
// Let's Work Together — Framer Reveal Footer Animation Style
// Source: https://framer.com/m/FooterAnimation-2nXF8s.js@dDuwh7azUF6193fTsD1j
// ==========================================================================
function initRevealFooterAnimation() {
    const contactSection = document.getElementById('contact');
    if (!contactSection) return;

    function reveal() {
        contactSection.classList.add('lf-inview');
        const descInner = contactSection.querySelector('.reveal-inner-desc');
        if (descInner) descInner.classList.add('revealed');
    }

    if (typeof IntersectionObserver === 'undefined') {
        reveal();
        return;
    }

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                reveal();
                observer.disconnect();
            }
        });
    }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });

    observer.observe(contactSection);

    // Initial viewport check
    const rect = contactSection.getBoundingClientRect();
    if (rect.top < window.innerHeight && rect.bottom > 0) {
        reveal();
    }
}

document.addEventListener('DOMContentLoaded', initRevealFooterAnimation);

// ==========================================================================
// Smart Contact Link (Email & Phone Popover & Clipboard)
// Adapted from https://smart-contact-link.framer.ai
// ==========================================================================
function initSmartContactLinks() {
    const wrappers = document.querySelectorAll('#contact .smart-contact-wrapper');
    if (!wrappers.length) return;

    function closeAll() {
        wrappers.forEach(w => {
            w.classList.remove('is-open');
            const trigger = w.querySelector('.smart-contact-trigger');
            const popup = w.querySelector('.smart-contact-popup');
            if (trigger) trigger.setAttribute('aria-expanded', 'false');
            if (popup) popup.setAttribute('aria-hidden', 'true');
        });
    }

    wrappers.forEach(wrapper => {
        const trigger = wrapper.querySelector('.smart-contact-trigger');
        const popup = wrapper.querySelector('.smart-contact-popup');
        const actionBtn = wrapper.querySelector('.smart-contact-action');
        const copyBtn = wrapper.querySelector('.smart-contact-copy');
        const val = wrapper.getAttribute('data-value') || '';
        let resetTimer = null;

        if (trigger) {
            trigger.addEventListener('click', (e) => {
                e.stopPropagation();
                const isOpen = wrapper.classList.contains('is-open');
                closeAll();
                if (!isOpen) {
                    wrapper.classList.add('is-open');
                    trigger.setAttribute('aria-expanded', 'true');
                    if (popup) popup.setAttribute('aria-hidden', 'false');
                }
            });
        }

        if (actionBtn) {
            actionBtn.addEventListener('click', () => {
                setTimeout(closeAll, 150);
            });
        }

        if (copyBtn) {
            copyBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                try {
                    if (navigator.clipboard && window.isSecureContext) {
                        await navigator.clipboard.writeText(val);
                    } else {
                        const ta = document.createElement('textarea');
                        ta.value = val;
                        ta.setAttribute('readonly', '');
                        ta.style.position = 'fixed';
                        ta.style.opacity = '0';
                        document.body.appendChild(ta);
                        ta.select();
                        document.execCommand('copy');
                        document.body.removeChild(ta);
                    }
                } catch (err) {
                    console.error('Clipboard copy failed', err);
                }

                copyBtn.classList.add('is-copied');
                if (resetTimer) clearTimeout(resetTimer);
                resetTimer = setTimeout(() => {
                    closeAll();
                    setTimeout(() => {
                        copyBtn.classList.remove('is-copied');
                    }, 250);
                }, 1400);
            });
        }
    });

    document.addEventListener('click', (e) => {
        if (!e.target.closest('#contact .smart-contact-wrapper')) {
            closeAll();
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeAll();
        }
    });
}

document.addEventListener('DOMContentLoaded', initSmartContactLinks);


// ==========================================================================
// Showcase Card Interactive Toggle (Visited Places)
// Faithfully replicated from https://showcasecardpreview.framer.website/
// ==========================================================================
// ==========================================================================
// Floating Card 3D Tilt Interaction (Research & Visited Places)
// Faithfully replicated from https://flotingcard.framer.website/
// ==========================================================================
function initFloatingCards() {
    const heroBoxes = document.querySelectorAll('.fc-hero-box');
    heroBoxes.forEach(box => {
        if (box.dataset.tiltBound === 'true') return;
        box.dataset.tiltBound = 'true';

        const badge = box.querySelector('.fc-float-badge');
        if (!badge) return;

        box.addEventListener('mousemove', (e) => {
            const rect = box.getBoundingClientRect();
            const x = e.clientX - rect.left - (rect.width / 2);
            const y = e.clientY - rect.top - (rect.height / 2);
            
            const rotateX = (-y / rect.height) * 16;
            const rotateY = (x / rect.width) * 16;
            
            badge.style.transform = "perspective(1000px) rotateX(" + rotateX.toFixed(2) + "deg) rotateY(" + rotateY.toFixed(2) + "deg) translateY(-8px) scale(1.02)";
        });

        box.addEventListener('mouseleave', () => {
            badge.style.transform = '';
        });
    });
}

function initShowcaseCard() {
    initFloatingCards();
}

document.addEventListener('DOMContentLoaded', initShowcaseCard);


// ==========================================================================
// Hero Intro: Liquid Glass Button Optical Tracking
// Faithfully replicated from https://liquid-glass-button.framer.website/
// ==========================================================================
function initLiquidGlassButton() {
    const btn = document.querySelector('.hero-intro.ml-optical-button');
    if (!btn || btn.dataset.liquidGlassBound === 'true') return;
    btn.dataset.liquidGlassBound = 'true';

    const reflection = btn.querySelector('.ml-optical-reflection');
    const edgeLight = btn.querySelector('.ml-optical-edge-light');
    const pointerLight = btn.querySelector('.ml-optical-pointer-light');

    btn.addEventListener('pointerenter', () => {
        btn.setAttribute('data-hover', 'true');
        if (edgeLight) edgeLight.style.opacity = '0.65';
        if (pointerLight) pointerLight.style.opacity = '0.55';
        if (reflection) reflection.style.opacity = '0.36';
    });

    btn.addEventListener('pointerleave', () => {
        btn.setAttribute('data-hover', 'false');
        if (edgeLight) edgeLight.style.opacity = '0';
        if (pointerLight) pointerLight.style.opacity = '0';
        if (reflection) {
            reflection.style.opacity = '0.18';
            reflection.style.transform = 'translateX(-20%)';
        }
    });

    btn.addEventListener('pointermove', (e) => {
        const rect = btn.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const relX = x / rect.width;
        const relY = y / rect.height;

        if (edgeLight) {
            edgeLight.style.background = `radial-gradient(90px 48px at ${x}px ${y}px, rgba(255, 255, 255, 0.95) 0%, rgba(255, 255, 255, 0.65) 32%, rgba(255, 255, 255, 0) 82%)`;
        }
        if (pointerLight) {
            pointerLight.style.background = `radial-gradient(76px 44px at ${x}px ${y}px, rgba(255, 255, 255, 0.22) 0%, rgba(255, 255, 255, 0.08) 36%, rgba(255, 255, 255, 0) 78%)`;
        }
        if (reflection) {
            const shiftX = (relX - 0.5) * 32;
            const shiftY = (relY - 0.5) * 12;
            reflection.style.transform = `translateX(${shiftX}%) translateY(${shiftY}%)`;
        }
    });
}

document.addEventListener('DOMContentLoaded', initLiquidGlassButton);


/* ==========================================================================
   Confidential Dossier Component (Achievements Section)
   Matches animation and style of https://earlier-stack-529814.framer.app
   ========================================================================== */

function initAchievementsDossier() {
    const wrapper = document.getElementById("framerDossierWrapper");
    if (!wrapper) return;
    if (wrapper.dataset.initialized === "true") return;
    wrapper.dataset.initialized = "true";

    const cardRoot = document.getElementById("dossierCardRoot");
    if (!cardRoot) return;

    const tabBtns = wrapper.querySelectorAll(".dossier-tab-btn");
    const serialEl = document.getElementById("dossierSerial");
    const eyebrowEl = document.getElementById("dossierEyebrow");
    const titleEl = document.getElementById("dossierTitle");
    const descEl = document.getElementById("dossierDesc");
    const primaryCta = document.getElementById("dossierPrimaryCta");
    const primaryLabel = document.getElementById("dossierPrimaryLabel");
    const secondaryCta = document.getElementById("dossierSecondaryCta");
    const secondaryLabel = document.getElementById("dossierSecondaryLabel");
    const recordBox = wrapper.querySelector(".dossier-record-data");
    const hintText = wrapper.querySelector(".dossier-hint-text");

    const achievements = [
        {
            tab: "Recognition",
            serial: "FILE // 01",
            eyebrow: "Think Bright Recognition",
            title: "Campus Ambassador of the Month",
            desc: "Honored for exceptional leadership, campus initiatives, and creative contributions toward expanding educational access and empowering students across the community.",
            primaryLabel: "View Recognition",
            primaryLink: "https://www.facebook.com/photo/?fbid=610498537854751&set=a.404964108408196",
            secondaryLabel: "Organization",
            secondaryLink: "https://www.facebook.com/thinkbright.xyz"
        },
        {
            tab: "Leadership",
            serial: "FILE // 02",
            eyebrow: "Academic & Tech Leadership",
            title: "Excellence in Mentorship & Leadership",
            desc: "Guiding over six years of private tutoring and active student representation at UITS, bridging theoretical computer science concepts with modern real-world practical software implementations.",
            primaryLabel: "Explore Journey",
            primaryLink: "#experience",
            secondaryLabel: "University",
            secondaryLink: "https://www.facebook.com/theuits"
        },
        {
            tab: "Innovation",
            serial: "FILE // 03",
            eyebrow: "IT Infrastructure & Research",
            title: "Network Systems & Innovation",
            desc: "Co-authored published ML research on drinking water potability prediction and spearheading robust corporate network server deployment and monitoring workflows.",
            primaryLabel: "Read Research",
            primaryLink: "#portfolio",
            secondaryLabel: "IT Operations",
            secondaryLink: "https://www.linkedin.com/company/mousumi-industries-limited/posts/?feedView=all"
        }
    ];

    let activeIndex = 0;
    let currentState = "closed"; // "closed" | "peeking" | "pulling" | "centering" | "open" | "closing"
    let isAnimating = false;

    function updateDossierData(newIndex) {
        if (newIndex < 0) newIndex = achievements.length - 1;
        if (newIndex >= achievements.length) newIndex = 0;
        activeIndex = newIndex;

        const item = achievements[activeIndex];

        tabBtns.forEach(function(btn, idx) {
            const isActive = idx === activeIndex;
            btn.classList.toggle("active", isActive);
            btn.setAttribute("aria-selected", isActive ? "true" : "false");
        });

        if (recordBox) {
            recordBox.style.opacity = "0.3";
            setTimeout(function() {
                if (serialEl) serialEl.textContent = item.serial;
                if (eyebrowEl) eyebrowEl.textContent = item.eyebrow;
                if (titleEl) titleEl.textContent = item.title;
                if (descEl) descEl.textContent = item.desc;

                if (primaryCta) {
                    primaryCta.href = item.primaryLink;
                    if (primaryLabel) primaryLabel.textContent = item.primaryLabel;
                }
                if (secondaryCta) {
                    secondaryCta.href = item.secondaryLink;
                    if (secondaryLabel) secondaryLabel.textContent = item.secondaryLabel;
                }
                recordBox.style.opacity = "1";
            }, 180);
        } else {
            if (serialEl) serialEl.textContent = item.serial;
            if (eyebrowEl) eyebrowEl.textContent = item.eyebrow;
            if (titleEl) titleEl.textContent = item.title;
            if (descEl) descEl.textContent = item.desc;
            if (primaryCta) {
                primaryCta.href = item.primaryLink;
                if (primaryLabel) primaryLabel.textContent = item.primaryLabel;
            }
            if (secondaryCta) {
                secondaryCta.href = item.secondaryLink;
                if (secondaryLabel) secondaryLabel.textContent = item.secondaryLabel;
            }
        }
    }

    function openDossier() {
        if (isAnimating || currentState === "open") return;
        isAnimating = true;

        cardRoot.classList.remove("is-peeking");
        cardRoot.classList.add("is-pulling");
        currentState = "pulling";

        // Step 1 -> Step 2 (after 200ms)
        setTimeout(function() {
            cardRoot.classList.remove("is-pulling");
            cardRoot.classList.add("is-centering");
            currentState = "centering";

            // Step 2 -> Step 3 (after 200ms)
            setTimeout(function() {
                cardRoot.classList.remove("is-centering");
                cardRoot.classList.add("is-open");
                currentState = "open";
                isAnimating = false;
                if (hintText) hintText.textContent = "Click dossier to close file";
            }, 200);
        }, 200);
    }

    function closeDossier() {
        if (isAnimating || currentState !== "open") return;
        isAnimating = true;
        currentState = "closing";

        // Step 1: Unflip card
        cardRoot.classList.remove("is-open");
        cardRoot.classList.add("is-closing-unflip");

        // Step 2: Open cover and slide card out to right (after 450ms)
        setTimeout(function() {
            cardRoot.classList.remove("is-closing-unflip");
            cardRoot.classList.add("is-closing-slide");

            // Step 3: Insert card back into folder (after 450ms)
            setTimeout(function() {
                cardRoot.classList.remove("is-closing-slide");
                cardRoot.classList.add("is-closing-insert");

                // Step 4: Close folder cover and reset (after 450ms)
                setTimeout(function() {
                    cardRoot.classList.remove("is-closing-insert");
                    currentState = "closed";
                    isAnimating = false;
                    if (hintText) hintText.textContent = "Hover to inspect • Click folder to open classified dossier";

                    if (cardRoot.matches(":hover")) {
                        cardRoot.classList.add("is-peeking");
                        currentState = "peeking";
                    }
                }, 450);
            }, 450);
        }, 450);
    }

    // Hover Peek Behavior
    cardRoot.addEventListener("mouseenter", function() {
        if (currentState === "closed" && !isAnimating) {
            currentState = "peeking";
            cardRoot.classList.add("is-peeking");
        }
    });

    cardRoot.addEventListener("mouseleave", function() {
        if (currentState === "peeking" && !isAnimating) {
            currentState = "closed";
            cardRoot.classList.remove("is-peeking");
        }
    });

    // Click toggle Behavior
    cardRoot.addEventListener("click", function(e) {
        // Don't toggle dossier if user clicks action buttons/links inside
        if (e.target.closest("a")) return;

        if (currentState === "open") {
            closeDossier();
        } else if (currentState === "closed" || currentState === "peeking") {
            openDossier();
        }
    });

    // Keyboard Accessibility
    cardRoot.addEventListener("keydown", function(e) {
        if (e.key === "Enter" || e.key === " ") {
            if (e.target.closest("a")) return;
            e.preventDefault();
            if (currentState === "open") {
                closeDossier();
            } else {
                openDossier();
            }
        }
    });

    // Tabs navigation
    tabBtns.forEach(function(btn, idx) {
        btn.addEventListener("click", function(e) {
            e.preventDefault();
            updateDossierData(idx);
            if (currentState === "closed" || currentState === "peeking") {
                openDossier();
            }
        });
    });

    // Set initial data
    updateDossierData(0);
}

// Backward compatibility alias for portfolio tabs initialization
function initFlexibleAccordion() {
    initAchievementsDossier();
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initAchievementsDossier);
} else {
    initAchievementsDossier();
}

/* ==========================================================================
   Core Competencies - Snapshot Footer Pocket Interactivity
   Reference: https://snapshotfooter.framer.website/
   Provides touch-tap toggle and keyboard access for lifting cards from pocket.
   ========================================================================== */
function initSnapshotCompetencies() {
    const pile = document.getElementById('sfPhotoPile');
    if (!pile) return;

    const cards = pile.querySelectorAll('.sf-photo-container, .sf-note-container');
    if (!cards.length) return;

    cards.forEach(card => {
        card.addEventListener('click', function(e) {
            const alreadyLifted = this.classList.contains('is-lifted');
            cards.forEach(c => c.classList.remove('is-lifted'));
            if (!alreadyLifted) {
                this.classList.add('is-lifted');
            }
        });

        card.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                const alreadyLifted = this.classList.contains('is-lifted');
                cards.forEach(c => c.classList.remove('is-lifted'));
                if (!alreadyLifted) {
                    this.classList.add('is-lifted');
                }
            }
        });
    });

    document.addEventListener('click', function(e) {
        if (!pile.contains(e.target)) {
            cards.forEach(c => c.classList.remove('is-lifted'));
        }
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSnapshotCompetencies);
} else {
    initSnapshotCompetencies();
}

/* ==========================================================================
   Personal Information — Framer Lanyard Pass Style
   Reference: https://basic-quail-243157.framer.app
   Features: 3D suspended badge swing, dynamic drop shadow, drag & throw physics
   ========================================================================== */
function initLanyardPass() {
    const stage = document.getElementById('lanyardStage');
    const card = document.getElementById('lanyardCard');
    if (!stage || !card) return;

    let currentRotX = 0;
    let currentRotY = 0;
    let currentRotZ = 0;
    let currentTransX = 0;
    let currentTransY = 0;

    let targetRotX = 0;
    let targetRotY = 0;
    let targetRotZ = 0;
    let targetTransX = 0;
    let targetTransY = 0;

    let velRotX = 0;
    let velRotY = 0;
    let velRotZ = 0;

    let isHovered = false;
    let isDragging = false;
    let isFlipped = false;
    let startX = 0;
    let startY = 0;
    let lastX = 0;
    let lastY = 0;
    let animFrameId = null;

    function startAnim() {
        if (!animFrameId) {
            animFrameId = requestAnimationFrame(updatePhysics);
        }
    }

    function updatePhysics() {
        const tension = 0.085;
        const damping = 0.84;

        // Spring forces on angles
        const forceX = (targetRotX - currentRotX) * tension;
        velRotX = (velRotX + forceX) * damping;
        currentRotX += velRotX;

        const forceY = (targetRotY - currentRotY) * tension;
        velRotY = (velRotY + forceY) * damping;
        currentRotY += velRotY;

        const forceZ = (targetRotZ - currentRotZ) * tension;
        velRotZ = (velRotZ + forceZ) * damping;
        currentRotZ += velRotZ;

        // Position interpolation
        currentTransX += (targetTransX - currentTransX) * 0.14;
        currentTransY += (targetTransY - currentTransY) * 0.14;

        // Dynamic shadow offset matching tilt angle
        const shadowX = (-currentRotY * 1.4).toFixed(1);
        const shadowY = (22 + currentRotX * 1.1 + currentTransY * 0.4).toFixed(1);
        const shadowBlur = (40 + Math.abs(currentRotY) * 0.7).toFixed(1);

        card.style.transform = `translate3d(${currentTransX.toFixed(1)}px, ${currentTransY.toFixed(1)}px, 0) rotateX(${currentRotX.toFixed(2)}deg) rotateY(${currentRotY.toFixed(2)}deg) rotateZ(${currentRotZ.toFixed(2)}deg)`;
        card.style.boxShadow = 'none';
        card.style.filter = `drop-shadow(${shadowX}px ${shadowY}px ${(shadowBlur * 0.45).toFixed(1)}px rgba(0, 0, 0, 0.65))`;

        const isSettled =
            Math.abs(velRotX) < 0.01 &&
            Math.abs(velRotY) < 0.01 &&
            Math.abs(velRotZ) < 0.01 &&
            Math.abs(targetRotX - currentRotX) < 0.05 &&
            Math.abs(targetRotY - currentRotY) < 0.05 &&
            Math.abs(targetRotZ - currentRotZ) < 0.05 &&
            Math.abs(targetTransX - currentTransX) < 0.1 &&
            Math.abs(targetTransY - currentTransY) < 0.1;

        if (!isSettled || isHovered || isDragging) {
            animFrameId = requestAnimationFrame(updatePhysics);
        } else {
            animFrameId = null;
        }
    }

    // Hover / mousemove 3D pendulum swing
    stage.addEventListener('pointerenter', () => {
        isHovered = true;
        startAnim();
    });

    stage.addEventListener('pointermove', (e) => {
        if (isDragging) return;
        const rect = card.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        const relX = (e.clientX - rect.left) / rect.width - 0.5;
        const relY = (e.clientY - rect.top) / rect.height - 0.5;

        targetRotY = relX * 28 + (isFlipped ? 180 : 0);
        targetRotX = -relY * 18;
        targetRotZ = relX * 7;
        startAnim();
    });

    stage.addEventListener('pointerleave', () => {
        if (isDragging) return;
        isHovered = false;
        targetRotX = 0;
        targetRotY = isFlipped ? 180 : 0;
        targetRotZ = 0;
        targetTransX = 0;
        targetTransY = 0;
        startAnim();
    });

    // Drag & throw interaction
    card.addEventListener('pointerdown', (e) => {
        // Don't drag if clicking links
        if (e.target.closest('a')) return;
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        lastX = e.clientX;
        lastY = e.clientY;
        velRotX = 0;
        velRotY = 0;
        velRotZ = 0;
        card.style.cursor = 'grabbing';
        try { card.setPointerCapture(e.pointerId); } catch (_) {}
        startAnim();
    });

    card.addEventListener('pointermove', (e) => {
        if (!isDragging) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;

        targetTransX = dx * 0.45;
        targetTransY = Math.max(-15, dy * 0.35);
        targetRotZ = (dx / 120) * 22;
        targetRotY = (dx / 140) * 36 + (isFlipped ? 180 : 0);
        targetRotX = -(dy / 140) * 20;

        velRotY = (e.clientX - lastX) * 0.45;
        velRotZ = (e.clientX - lastX) * 0.25;
        velRotX = -(e.clientY - lastY) * 0.3;
        lastX = e.clientX;
        lastY = e.clientY;
    });

    function endDrag(e) {
        if (!isDragging) return;
        isDragging = false;
        card.style.cursor = 'grab';
        try { card.releasePointerCapture(e.pointerId); } catch (_) {}

        targetTransX = 0;
        targetTransY = 0;
        targetRotX = 0;
        targetRotZ = 0;
        targetRotY = isFlipped ? 180 : 0;
        startAnim();
    }

    card.addEventListener('pointerup', endDrag);
    card.addEventListener('pointercancel', endDrag);

    // Double-click or hint click to flip
    card.addEventListener('dblclick', () => {
        isFlipped = !isFlipped;
        targetRotY = isFlipped ? 180 : 0;
        startAnim();
    });

    const hint = stage.querySelector('.lanyard-hint');
    if (hint) {
        hint.style.cursor = 'pointer';
        hint.addEventListener('click', () => {
            isFlipped = !isFlipped;
            targetRotY = isFlipped ? 180 : 0;
            startAnim();
        });
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initLanyardPass);
} else {
    initLanyardPass();
}

/* ==========================================================================
   Team Folio Pro Component Controller
   Reference: https://www.framer.com/marketplace/components/team-folio-pro
   ========================================================================== */
function initTeamFolioPro() {
    const section = document.getElementById('teamFolioSection');
    if (!section || section.dataset.initialized === 'true') return;
    section.dataset.initialized = 'true';

    const track = section.querySelector('.tfp-track');
    const cards = Array.from(section.querySelectorAll('.tfp-card'));
    const prevBtn = section.querySelector('.tfp-nav-prev');
    const nextBtn = section.querySelector('.tfp-nav-next');
    const counterCurrent = section.querySelector('.tfp-counter-current');
    const filterChips = Array.from(section.querySelectorAll('.tfp-chip'));

    if (!track || !cards.length) return;

    let activeIndex = 0;
    let isDragging = false;
    let startX = 0;
    let scrollLeftStart = 0;
    let hasMoved = false;

    function updateActiveState(index) {
        if (index < 0) index = 0;
        if (index >= cards.length) index = cards.length - 1;
        activeIndex = index;

        if (counterCurrent) {
            counterCurrent.textContent = String(activeIndex + 1).padStart(2, '0');
        }

        if (prevBtn) prevBtn.disabled = activeIndex === 0;
        if (nextBtn) nextBtn.disabled = activeIndex === cards.length - 1;
    }

    function scrollToCard(index) {
        if (index < 0 || index >= cards.length) return;
        const card = cards[index];
        const cardLeft = card.offsetLeft;
        const trackPaddingLeft = parseFloat(getComputedStyle(track).paddingLeft) || 0;
        track.scrollTo({
            left: cardLeft - trackPaddingLeft,
            behavior: 'smooth'
        });
        updateActiveState(index);
    }

    // Toggle card expansion
    cards.forEach((card, idx) => {
        const dotBtn = card.querySelector('.tfp-dot-btn');
        const portrait = card.querySelector('.tfp-portrait-wrap');

        function toggleCard(e) {
            if (hasMoved) return;
            if (e) e.stopPropagation();
            const isOpen = card.classList.contains('is-open');

            // Close other cards for clean accordion-style focus
            cards.forEach(c => {
                if (c !== card) {
                    c.classList.remove('is-open');
                    const b = c.querySelector('.tfp-dot-btn');
                    if (b) {
                        b.setAttribute('aria-expanded', 'false');
                        b.setAttribute('data-open', 'false');
                    }
                }
            });

            if (isOpen) {
                card.classList.remove('is-open');
                if (dotBtn) {
                    dotBtn.setAttribute('aria-expanded', 'false');
                    dotBtn.setAttribute('data-open', 'false');
                }
            } else {
                card.classList.add('is-open');
                if (dotBtn) {
                    dotBtn.setAttribute('aria-expanded', 'true');
                    dotBtn.setAttribute('data-open', 'true');
                }
                setTimeout(() => scrollToCard(idx), 80);
            }
        }

        if (dotBtn) dotBtn.addEventListener('click', toggleCard);
        if (portrait) portrait.addEventListener('click', toggleCard);
    });

    if (prevBtn) {
        prevBtn.addEventListener('click', () => {
            scrollToCard(activeIndex - 1);
        });
    }
    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            scrollToCard(activeIndex + 1);
        });
    }

    filterChips.forEach(chip => {
        chip.addEventListener('click', () => {
            filterChips.forEach(c => {
                c.classList.remove('active');
                c.setAttribute('aria-selected', 'false');
            });
            chip.classList.add('active');
            chip.setAttribute('aria-selected', 'true');

            const filter = chip.dataset.filter;
            if (filter === 'all') {
                cards.forEach(c => {
                    c.style.display = '';
                    c.style.opacity = '1';
                });
                scrollToCard(0);
            } else {
                let firstMatchIdx = -1;
                cards.forEach((c, i) => {
                    if (c.dataset.category === filter) {
                        c.style.display = '';
                        c.style.opacity = '1';
                        if (firstMatchIdx === -1) firstMatchIdx = i;
                    } else {
                        c.style.opacity = '0.2';
                    }
                });
                if (firstMatchIdx !== -1) {
                    scrollToCard(firstMatchIdx);
                }
            }
        });
    });

    let scrollTimeout;
    track.addEventListener('scroll', () => {
        clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(() => {
            const trackCenter = track.scrollLeft + track.clientWidth / 2;
            let closestIdx = 0;
            let minDiff = Infinity;

            cards.forEach((card, i) => {
                const cardCenter = card.offsetLeft + card.offsetWidth / 2;
                const diff = Math.abs(trackCenter - cardCenter);
                if (diff < minDiff) {
                    minDiff = diff;
                    closestIdx = i;
                }
            });

            updateActiveState(closestIdx);
        }, 50);
    }, { passive: true });

    track.addEventListener('mousedown', (e) => {
        if (e.target.closest('button, a')) return;
        isDragging = true;
        hasMoved = false;
        startX = e.pageX - track.offsetLeft;
        scrollLeftStart = track.scrollLeft;
        track.style.cursor = 'grabbing';
    });

    window.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        const x = e.pageX - track.offsetLeft;
        const walk = (x - startX) * 1.5;
        if (Math.abs(walk) > 4) hasMoved = true;
        track.scrollLeft = scrollLeftStart - walk;
    });

    window.addEventListener('mouseup', () => {
        if (!isDragging) return;
        isDragging = false;
        track.style.cursor = 'grab';
    });

    updateActiveState(0);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTeamFolioPro);
} else {
    initTeamFolioPro();
}


/* ==========================================================================
   Video Wall Gallery (Movies I've Seen! Watchlist)
   Faithfully inspired by: https://videowallgallery.framer.website/
   ========================================================================== */
(function() {
    'use strict';

    const moviesData = [
        { id: 'tt0046250', title: 'Roman Holiday', year: 1953, rating: 8, runtime: '1h 58m', genres: ["Comedy", "Drama", "Romance"], director: 'William Wyler', stars: ["Gregory Peck", "Audrey Hepburn", "Eddie Albert", "Hartley Power"], plot: 'A bored and sheltered princess escapes her guardians and falls in love with an American newsman in Rome.' },
        { id: 'tt1483013', title: 'Oblivion', year: 2013, rating: 7, runtime: '2h 4m', genres: ["Action", "Adventure", "Sci-Fi"], director: 'Joseph Kosinski', stars: ["Tom Cruise", "Morgan Freeman", "Andrea Riseborough", "Olga Kurylenko"], plot: 'A stranger\'s arrival triggers one man\'s battle to save mankind.' },
        { id: 'tt0154506', title: 'Following', year: 1998, rating: 7.4, runtime: '1h 10m', genres: ["Crime", "Mystery", "Thriller"], director: 'Christopher Nolan', stars: ["Jeremy Theobald", "Alex Haw", "Lucy Russell", "John Nolan"], plot: 'A young writer who follows strangers for material meets a thief who takes him under his wing.' },
        { id: 'tt11286314', title: 'Don\'t Look Up', year: 2021, rating: 7.1, runtime: '2h 18m', genres: ["Comedy", "Drama", "Sci-Fi"], director: 'Adam McKay', stars: ["Leonardo DiCaprio", "Jennifer Lawrence", "Meryl Streep", "Cate Blanchett"], plot: 'Two low-level astronomers must go on a giant media tour to warn humankind of an approaching comet that will destroy planet Earth.' },
        { id: 'tt0180093', title: 'Requiem for a Dream', year: 2000, rating: 8.3, runtime: '1h 42m', genres: ["Drama"], director: 'Darren Aronofsky', stars: ["Ellen Burstyn", "Jared Leto", "Jennifer Connelly", "Marlon Wayans"], plot: 'Four Coney Island dreamers chase love, fame, and escape, but addiction and obsession begin to distort their hopes for a better life.' },
        { id: 'tt0420332', title: 'Veer Zaara', year: 2004, rating: 7.8, runtime: '3h 12m', genres: ["Drama", "Family", "Musical"], director: 'Yash Chopra', stars: ["Shah Rukh Khan", "Preity G Zinta", "Rani Mukerji", "Kirron Kher"], plot: 'An Indian Air Force pilot rescues a Pakistani girl stranded in India. Years later, a lawyer seeks to unravel the truth behind the pilot\'s mysterious imprisonment in Pakistan for over two decades, during which he remained silent.' },
        { id: 'tt0238936', title: 'Devdas', year: 2002, rating: 7.6, runtime: '3h 5m', genres: ["Drama", "Musical", "Romance"], director: 'Sanjay Leela Bhansali', stars: ["Shah Rukh Khan", "Aishwarya Rai Bachchan", "Madhuri Dixit", "Jackie Shroff"], plot: 'After his wealthy family prohibits him from marrying the woman he is in love with, Devdas Mukherjee\'s life spirals further and further out of control as he takes up alcohol and a life of vice to numb the pain.' },
        { id: 'tt1270797', title: 'Venom', year: 2018, rating: 6.6, runtime: '1h 52m', genres: ["Action", "Adventure", "Sci-Fi"], director: 'Ruben Fleischer', stars: ["Tom Hardy", "Michelle Williams", "Riz Ahmed", "Scott Haze"], plot: 'A failed reporter is bonded to an alien entity, one of many symbiotes who have invaded Earth. But the being takes a liking to Earth and decides to protect it.' },
        { id: 'tt4857264', title: 'The Invisible Guest', year: 2016, rating: 8, runtime: '1h 46m', genres: ["Crime", "Drama", "Mystery"], director: 'Oriol Paulo', stars: ["Mario Casas", "Ana Wagener", "Jose Coronado", "B\u251c\u00edrbara Lennie"], plot: 'A young businessman wakes up in a hotel room locked from the inside with the dead body of his lover next to him. He hires a prestigious lawyer, and over one night they work together to clarify what happened in a frenetic race against time.' },
        { id: 'tt1568346', title: 'The Girl with the Dragon Tattoo', year: 2011, rating: 7.8, runtime: '2h 38m', genres: ["Crime", "Drama", "Mystery"], director: 'David Fincher', stars: ["Daniel Craig", "Rooney Mara", "Christopher Plummer", "Stellan Skarsg\u251c\u00d1rd"], plot: 'Journalist Mikael Blomkvist is aided by eccentric hacker Lisbeth Salander in his search for a woman who has been missing for 40 years.' },
        { id: 'tt2582802', title: 'Whiplash', year: 2014, rating: 8.5, runtime: '1h 46m', genres: ["Drama", "Music"], director: 'Damien Chazelle', stars: ["Miles Teller", "J.K. Simmons", "Melissa Benoist", "Paul Reiser"], plot: 'A promising young drummer enrolls at a cut-throat music conservatory where his dreams of greatness are mentored by an instructor who will stop at nothing to realize a student\'s potential.' },
        { id: 'tt5580390', title: 'The Shape of Water', year: 2017, rating: 7.3, runtime: '2h 3m', genres: ["Drama", "Fantasy", "Romance"], director: 'Guillermo del Toro', stars: ["Sally Hawkins", "Octavia Spencer", "Michael Shannon", "Richard Jenkins"], plot: 'At a top secret research facility in the 1960s, a lonely janitor forms a unique relationship with an amphibious creature that is being held in captivity.' },
        { id: 'tt2674426', title: 'Me Before You', year: 2016, rating: 7.4, runtime: '1h 50m', genres: ["Drama", "Romance"], director: 'Thea Sharrock', stars: ["Emilia Clarke", "Sam Claflin", "Janet McTeer", "Vanessa Kirby"], plot: 'A girl in a small town forms an unlikely bond with a recently-paralyzed man she\'s taking care of.' },
        { id: 'tt1302006', title: 'The Irishman', year: 2019, rating: 7.8, runtime: '3h 29m', genres: ["Biography", "Crime", "Drama"], director: 'Martin Scorsese', stars: ["Robert De Niro", "Al Pacino", "Joe Pesci", "Harvey Keitel"], plot: 'An illustration of Frank Sheeran\'s life, from W.W.II veteran to hit-man for the Bufalino crime family and his alleged assassination of his close friend Jimmy Hoffa.' },
        { id: 'tt2980516', title: 'The Theory of Everything', year: 2014, rating: 7.7, runtime: '2h 3m', genres: ["Biography", "Drama", "Romance"], director: 'James Marsh', stars: ["Eddie Redmayne", "Felicity Jones", "Tom Prior", "Sophie Perry"], plot: 'Stephen Hawking gets unprecedented success in the field of physics despite being diagnosed with motor neuron disease at the age of 21. He defeats awful odds as his first wife Jane aids him loyally.' },
        { id: 'tt0087843', title: 'Once Upon a Time in America', year: 1984, rating: 8.3, runtime: '3h 49m', genres: ["Crime", "Drama"], director: 'Sergio Leone', stars: ["Robert De Niro", "James Woods", "Elizabeth McGovern", "Treat Williams"], plot: 'A former New York gangster returns after decades in exile, confronting the friendships, dreams, and regrets that shaped his rise from street kid to Prohibition-era mobster.' },
        { id: 'tt0097165', title: 'Dead Poets Society', year: 1989, rating: 8.1, runtime: '2h 8m', genres: ["Comedy", "Drama"], director: 'Peter Weir', stars: ["Robin Williams", "Robert Sean Leonard", "Ethan Hawke", "Josh Charles"], plot: 'A maverick teacher at a prestigious New England boys\' boarding school uses poetry to embolden his pupils to new heights of self-expression.' },
        { id: 'tt0106519', title: 'Carlito\'s Way', year: 1993, rating: 7.9, runtime: '2h 24m', genres: ["Crime", "Drama", "Thriller"], director: 'Brian De Palma', stars: ["Al Pacino", "Sean Penn", "Penelope Ann Miller", "John Leguizamo"], plot: 'A recently released convict, determined to avoid making the same mistakes as before, is drawn into a fresh web of crime and corruption.' },
        { id: 'tt0112384', title: 'Apollo 13', year: 1995, rating: 7.7, runtime: '2h 20m', genres: ["Adventure", "Drama", "History"], director: 'Ron Howard', stars: ["Tom Hanks", "Bill Paxton", "Kevin Bacon", "Gary Sinise"], plot: 'NASA must devise a strategy to return Apollo 13 to Earth safely after the spacecraft undergoes massive internal damage putting the lives of the three astronauts on board in jeopardy.' },
        { id: 'tt3062096', title: 'Inferno', year: 2016, rating: 6.2, runtime: '2h 1m', genres: ["Action", "Adventure", "Crime"], director: 'Ron Howard', stars: ["Tom Hanks", "Felicity Jones", "Irrfan Khan", "Omar Sy"], plot: 'Robert Langdon must stop a madman from unleashing a virus that could kill half of the population.' },
        { id: 'tt2119532', title: 'Hacksaw Ridge', year: 2016, rating: 8.1, runtime: '2h 19m', genres: ["Biography", "Drama", "History"], director: 'Mel Gibson', stars: ["Andrew Garfield", "Sam Worthington", "Luke Bracey", "Richard Pyros"], plot: 'World War II American Army Medic Desmond T. Doss, serving during the Battle of Okinawa, refuses to kill people and becomes the first man in American history to receive the Medal of Honor without firing a shot.' },
        { id: 'tt1645170', title: 'The Dictator', year: 2012, rating: 6.5, runtime: '1h 23m', genres: ["Comedy"], director: 'Larry Charles', stars: ["Sacha Baron Cohen", "Anna Faris", "John C. Reilly", "Sayed Badreya"], plot: 'The heroic story of a dictator who risked his life to ensure that democracy would never come to the country he so lovingly oppressed.' },
        { id: 'tt0120338', title: 'Titanic', year: 1997, rating: 8, runtime: '3h 14m', genres: ["Drama", "Romance"], director: 'James Cameron', stars: ["Leonardo DiCaprio", "Kate Winslet", "Billy Zane", "Kathy Bates"], plot: 'A young aristocrat falls in love with a poor artist aboard the luxurious, ill-fated RMS Titanic.' },
        { id: 'tt0499549', title: 'Avatar', year: 2009, rating: 7.9, runtime: '2h 42m', genres: ["Action", "Adventure", "Fantasy"], director: 'James Cameron', stars: ["Sam Worthington", "Zoe Salda\u251c\u2592a", "Sigourney Weaver", "Stephen Lang"], plot: 'A paraplegic Marine dispatched to the moon Pandora on a unique mission becomes torn between following his orders and protecting the world he feels is his home.' },
        { id: 'tt3659388', title: 'The Martian', year: 2015, rating: 8, runtime: '2h 24m', genres: ["Adventure", "Drama", "Sci-Fi"], director: 'Ridley Scott', stars: ["Matt Damon", "Jessica Chastain", "Kristen Wiig", "Jeff Daniels"], plot: 'An astronaut stranded on Mars must rely on his ingenuity to survive and arrange a potential rescue.' },
        { id: 'tt0099685', title: 'GoodFellas', year: 1990, rating: 8.7, runtime: '2h 25m', genres: ["Biography", "Crime", "Drama"], director: 'Martin Scorsese', stars: ["Robert De Niro", "Ray Liotta", "Joe Pesci", "Lorraine Bracco"], plot: 'The story of Henry Hill and his life in the mafia, covering his relationship with his wife Karen and his mob partners Jimmy Conway and Tommy DeVito.' },
        { id: 'tt1535109', title: 'Captain Phillips', year: 2013, rating: 7.8, runtime: '2h 14m', genres: ["Action", "Biography", "Crime"], director: 'Paul Greengrass', stars: ["Tom Hanks", "Barkhad Abdi", "Barkhad Abdirahman", "Catherine Keener"], plot: 'The true story of Captain Richard Phillips and the 2009 hijacking by Somali pirates of the U.S.-flagged MV Maersk Alabama, the first American cargo ship to be hijacked in two hundred years.' },
        { id: 'tt0914798', title: 'The Boy in the Striped Pajamas', year: 2008, rating: 7.7, runtime: '1h 34m', genres: ["Drama", "War"], director: 'Mark Herman', stars: ["Asa Butterfield", "David Thewlis", "Rupert Friend", "Zac Mattoon O'Brien"], plot: 'Through the innocent eyes of Bruno, the eight-year-old son of the commandant at a German concentration camp, a forbidden friendship with a Jewish boy on the other side of the camp fence has startling and unexpected consequences.' },
        { id: 'tt2084970', title: 'The Imitation Game', year: 2014, rating: 8, runtime: '1h 54m', genres: ["Biography", "Drama", "Thriller"], director: 'Morten Tyldum', stars: ["Benedict Cumberbatch", "Keira Knightley", "Matthew Goode", "Rory Kinnear"], plot: 'During World War II, the English mathematical genius Alan Turing tries to crack the German Enigma code with help from fellow mathematicians while attempting to come to terms with his troubled private life.' },
        { id: 'tt1343092', title: 'The Great Gatsby', year: 2013, rating: 7.2, runtime: '2h 23m', genres: ["Drama", "Romance"], director: 'Baz Luhrmann', stars: ["Leonardo DiCaprio", "Carey Mulligan", "Joel Edgerton", "Lisa Adam"], plot: 'A writer and wall street trader, Nick Carraway, finds himself drawn to the past and lifestyle of his mysterious millionaire neighbor, Jay Gatsby, amid the riotous parties of the Jazz Age.' },
        { id: 'tt7131622', title: 'Once Upon a Time in... Hollywood', year: 2019, rating: 7.6, runtime: '2h 41m', genres: ["Comedy", "Drama"], director: 'Quentin Tarantino', stars: ["Leonardo DiCaprio", "Brad Pitt", "Margot Robbie", "Emile Hirsch"], plot: 'As Hollywood\'s Golden Age is winding down, a television actor and his stunt double endeavor to achieve lasting success.' },
        { id: 'tt0060196', title: 'The Good, the Bad and the Ugly', year: 1966, rating: 8.8, runtime: '2h 58m', genres: ["Adventure", "Drama", "Western"], director: 'Sergio Leone', stars: ["Clint Eastwood", "Eli Wallach", "Lee Van Cleef", "Aldo Giuffr\u251c\u00bf"], plot: 'A bounty-hunting scam joins two men in an uneasy alliance against a third in a race to find a fortune in gold buried in a remote cemetery.' },
        { id: 'tt0871510', title: 'Chak De! India', year: 2007, rating: 8.1, runtime: '2h 33m', genres: ["Drama", "Family", "Sport"], director: 'Shimit Amin', stars: ["Shah Rukh Khan", "Vidya Malvade", "Sagarika Ghatge", "Shilpa Shukla"], plot: 'Kabir Khan, the coach of the Indian Women\'s National Hockey Team, dreams of making his all-girls team emerge victorious against all odds.' },
        { id: 'tt0278504', title: 'Insomnia', year: 2002, rating: 7.2, runtime: '1h 58m', genres: ["Drama", "Mystery", "Thriller"], director: 'Christopher Nolan', stars: ["Al Pacino", "Robin Williams", "Hilary Swank", "Martin Donovan"], plot: 'A Los Angeles detective chases a murder suspect in a remote Alaskan town.' },
        { id: 'tt0132477', title: 'October Sky', year: 1999, rating: 7.8, runtime: '1h 48m', genres: ["Biography", "Drama", "Family"], director: 'Joe Johnston', stars: ["Jake Gyllenhaal", "Chris Cooper", "Laura Dern", "Chris Owen"], plot: 'The true story of Homer Hickam, a coal miner\'s son who was inspired by the first Sputnik launch to take up rocketry against his father\'s wishes.' },
        { id: 'tt1285016', title: 'The Social Network', year: 2010, rating: 7.8, runtime: '2h 0m', genres: ["Biography", "Drama"], director: 'David Fincher', stars: ["Jesse Eisenberg", "Andrew Garfield", "Justin Timberlake", "Rooney Mara"], plot: 'As Harvard student Mark Zuckerberg creates the social networking site that would become known as Facebook, he is sued by the twins who claimed he stole their idea and by the co-founder who was later squeezed out of the business.' },
        { id: 'tt0118694', title: 'In the Mood for Love', year: 2000, rating: 8, runtime: '1h 38m', genres: ["Drama", "Romance"], director: 'Wong Kar-Wai', stars: ["Maggie Cheung", "Tony Leung Chiu-wai", "Ping-Lam Siu", "Tung Cho 'Joe' Cheung"], plot: 'Two neighbors form a strong bond after both suspect extramarital activities of their spouses. However, they agree to keep their bond platonic so as not to commit similar wrongs.' },
        { id: 'tt0892769', title: 'How to Train Your Dragon', year: 2010, rating: 8.1, runtime: '1h 38m', genres: ["Animation", "Action", "Adventure"], director: '', stars: ["Jay Baruchel", "Gerard Butler", "Christopher Mintz-Plasse", "Craig Ferguson"], plot: 'A hapless young Viking who aspires to hunt dragons becomes the unlikely friend of a young dragon himself, and learns there may be more to the creatures than he assumed.' },
        { id: 'tt0469494', title: 'There Will Be Blood', year: 2007, rating: 8.2, runtime: '2h 38m', genres: ["Drama"], director: 'Paul Thomas Anderson', stars: ["Daniel Day-Lewis", "Paul Dano", "Ciar\u251c\u00edn Hinds", "Martin Stringer"], plot: 'A story of family, religion, hatred, oil and madness, focusing on a turn-of-the-century prospector in the early days of the business.' },
        { id: 'tt1049413', title: 'Up', year: 2009, rating: 8.3, runtime: '1h 36m', genres: ["Animation", "Adventure", "Comedy"], director: '', stars: ["Edward Asner", "Jordan Nagai", "John Ratzenberger", "Christopher Plummer"], plot: 'A grumpy old man turns his house into an airship using balloons and flies off to South America with a young stowaway.' },
        { id: 'tt0338013', title: 'Eternal Sunshine of the Spotless Mind', year: 2004, rating: 8.3, runtime: '1h 48m', genres: ["Drama", "Romance", "Sci-Fi"], director: 'Michel Gondry', stars: ["Jim Carrey", "Kate Winslet", "Tom Wilkinson", "Gerry Robert Byrne"], plot: 'When their relationship turns sour, a couple undergoes a medical procedure to have each other erased from their memories forever.' },
        { id: 'tt1187043', title: '3 Idiots', year: 2009, rating: 8.4, runtime: '2h 50m', genres: ["Comedy", "Drama"], director: 'Rajkumar Hirani', stars: ["Aamir Khan", "Madhavan", "Mona Singh", "Sharman Joshi"], plot: 'Two friends search for a brilliant, free-spirited classmate whose unconventional approach to engineering school changed their lives and challenged a rigid education system.' },
        { id: 'tt7286456', title: 'Joker', year: 2019, rating: 8.3, runtime: '2h 2m', genres: ["Drama", "Thriller"], director: 'Todd Phillips', stars: ["Joaquin Phoenix", "Robert De Niro", "Zazie Beetz", "Frances Conroy"], plot: 'Arthur Fleck, a party clown and a failed stand-up comedian, leads an impoverished life with his ailing mother. However, when society shuns him and brands him as a freak, he decides to embrace the life of chaos in Gotham City.' },
        { id: 'tt0209144', title: 'Memento', year: 2000, rating: 8.4, runtime: '1h 53m', genres: ["Mystery", "Thriller"], director: 'Christopher Nolan', stars: ["Guy Pearce", "Carrie-Anne Moss", "Joe Pantoliano", "Mark Boone Junior"], plot: 'A former insurance investigator who now suffers from anterograde amnesia uses notes and tattoos to hunt down his wife\'s murderer.' },
        { id: 'tt6751668', title: 'Parasite', year: 2019, rating: 8.5, runtime: '2h 12m', genres: ["Drama", "Thriller"], director: 'Bong Joon Ho', stars: ["Song Kang-ho", "Lee Sun-kyun", "Cho Yeo-jeong", "Choi Woo-sik"], plot: 'Greed and class discrimination threaten the newly formed symbiotic relationship between the wealthy Park family and the destitute Kim clan.' },
        { id: 'tt0816692', title: 'Interstellar', year: 2014, rating: 8.7, runtime: '2h 49m', genres: ["Adventure", "Sci-Fi"], director: 'Christopher Nolan', stars: ["Matthew McConaughey", "Anne Hathaway", "Jessica Chastain", "Ellen Burstyn"], plot: 'In a dystopian future where Earth has become near-uninhabitable, a team of astronauts embark on a mission to find a new home for humanity.' },
        { id: 'tt0245429', title: 'Spirited Away', year: 2001, rating: 8.6, runtime: '2h 4m', genres: ["Animation", "Adventure", "Family"], director: 'Hayao Miyazaki', stars: ["Miyu Irino", "Rumi Hiiragi", "Mari Natsuki", "Takashi Nait\u251c\u2524"], plot: 'During her family\'s move to the suburbs, a sullen 10-year-old girl wanders into a world ruled by gods, witches and spirits, and where humans are changed into beasts.' },
        { id: 'tt0317248', title: 'City of God', year: 2002, rating: 8.6, runtime: '2h 10m', genres: ["Crime", "Drama"], director: '', stars: ["Alexandre Rodrigues", "Leandro Firmino", "Matheus Nachtergaele", "Phellipe Haagensen"], plot: 'In the slums of Rio, two kids\' paths diverge as one struggles to become a photographer and the other a kingpin.' },
        { id: 'tt0109830', title: 'Forrest Gump', year: 1994, rating: 8.8, runtime: '2h 22m', genres: ["Drama", "Romance"], director: 'Robert Zemeckis', stars: ["Tom Hanks", "Robin Wright", "Gary Sinise", "Rebecca Williams"], plot: 'The history of the United States from the 1950s to the \'70s unfolds from the perspective of an Alabama man with an IQ of 75, who yearns to be reunited with his childhood sweetheart.' },
        { id: 'tt0110912', title: 'Pulp Fiction', year: 1994, rating: 8.8, runtime: '2h 34m', genres: ["Crime", "Drama"], director: 'Quentin Tarantino', stars: ["John Travolta", "Uma Thurman", "Samuel L. Jackson", "Tim Roth"], plot: 'The lives of two mob hitmen, a boxer, a gangster and his wife, and a pair of diner bandits intertwine in four tales of violence and redemption.' },
        { id: 'tt0111161', title: 'The Shawshank Redemption', year: 1994, rating: 9.3, runtime: '2h 22m', genres: ["Drama"], director: 'Frank Darabont', stars: ["Tim Robbins", "Morgan Freeman", "Bob Gunton", "William Sadler"], plot: 'After a banker is sentenced to life in Shawshank Prison, he forms an unlikely friendship with a seasoned inmate and clings to hope amid cruelty and corruption.' },
        { id: 'tt0110413', title: 'L├⌐on: The Professional', year: 1994, rating: 8.5, runtime: '1h 50m', genres: ["Action", "Crime", "Drama"], director: 'Luc Besson', stars: ["Jean Reno", "Gary Oldman", "Natalie Portman", "Danny Aiello"], plot: 'When her family is murdered by a group of corrupt officers led by the tyrannical Norman Stansfield, a young 12-year-old girl enlists the help of an Italian-American hitman to seek revenge.' },
        { id: 'tt6966692', title: 'Green Book', year: 2018, rating: 8.2, runtime: '2h 10m', genres: ["Biography", "Comedy", "Drama"], director: 'Peter Farrelly', stars: ["Viggo Mortensen", "Mahershala Ali", "Linda Cardellini", "Sebastian Maniscalco"], plot: 'A working-class Italian-American bouncer becomes the driver for an African-American classical pianist on a tour of venues through the 1960s American South.' },
        { id: 'tt0253474', title: 'The Pianist', year: 2002, rating: 8.5, runtime: '2h 30m', genres: ["Biography", "Drama", "Music"], director: 'Roman Polanski', stars: ["Adrien Brody", "Thomas Kretschmann", "Frank Finlay", "Emilia Fox"], plot: 'During WWII, acclaimed Polish musician Wladyslaw faces various struggles as he loses contact with his family. As the situation worsens, he hides in the ruins of Warsaw in order to survive.' },
        { id: 'tt0382625', title: 'The Da Vinci Code', year: 2006, rating: 6.7, runtime: '2h 29m', genres: ["Mystery", "Thriller"], director: 'Ron Howard', stars: ["Tom Hanks", "Audrey Tautou", "Jean Reno", "Ian McKellen"], plot: 'A murder and clues in paintings lead to the discovery of a closely guarded religious mystery.' },
        { id: 'tt0316654', title: 'Spider-Man 2', year: 2004, rating: 7.5, runtime: '2h 7m', genres: ["Action", "Adventure", "Sci-Fi"], director: 'Sam Raimi', stars: ["Tobey Maguire", "Kirsten Dunst", "Alfred Molina", "James Franco"], plot: 'Peter Parker is beset with troubles in his failing personal life as he battles a former brilliant scientist named Otto Octavius.' },
        { id: 'tt1022603', title: '500 Days of Summer', year: 2009, rating: 7.6, runtime: '1h 35m', genres: ["Comedy", "Drama", "Romance"], director: 'Marc Webb', stars: ["Zooey Deschanel", "Joseph Gordon-Levitt", "Geoffrey Arend", "Chlo\u251c\u00bd Grace Moretz"], plot: 'After being dumped by the girl he believes to be his soulmate, hopeless romantic Tom Hansen reflects on their relationship to try and figure out where things went wrong and how he can win her back.' },
        { id: 'tt6723592', title: 'Tenet', year: 2020, rating: 7.3, runtime: '2h 30m', genres: ["Action", "Sci-Fi", "Thriller"], director: 'Christopher Nolan', stars: ["John David Washington", "Robert Pattinson", "Elizabeth Debicki", "Juhan Ulfsak"], plot: 'Armed with only the word \"Tenet,\" and fighting for the survival of the entire world, CIA operative, The Protagonist, journeys through a twilight world of international espionage on a global mission that unfolds beyond real time.' },
        { id: 'tt0964517', title: 'The Fighter', year: 2010, rating: 7.8, runtime: '1h 56m', genres: ["Action", "Biography", "Drama"], director: 'David O. Russell', stars: ["Mark Wahlberg", "Christian Bale", "Amy Adams", "Melissa Leo"], plot: 'Based on the story of Micky Ward, a fledgling boxer who tries to escape the shadow of his more famous but troubled older boxing brother and get his own shot at greatness.' },
        { id: 'tt5013056', title: 'Dunkirk', year: 2017, rating: 7.8, runtime: '1h 46m', genres: ["Action", "Drama", "History"], director: 'Christopher Nolan', stars: ["Fionn Whitehead", "Barry Keoghan", "Mark Rylance", "Damien Bonnard"], plot: 'Allied soldiers from Belgium, the British Commonwealth and Empire, and France are surrounded by the German Army and evacuated during a fierce battle in World War II.' },
        { id: 'tt10272386', title: 'The Father', year: 2020, rating: 8.2, runtime: '1h 37m', genres: ["Drama", "Mystery"], director: 'Florian Zeller', stars: ["Anthony Hopkins", "Olivia Colman", "Mark Gatiss", "Olivia Williams"], plot: 'A man refuses all assistance from his daughter as he ages. When he tries to understand what is happening around him, he begins to doubt his loved ones, his own mind and even the fabric of his reality.' },
        { id: 'tt0062622', title: '2001: A Space Odyssey', year: 1968, rating: 8.3, runtime: '2h 29m', genres: ["Adventure", "Sci-Fi"], director: 'Stanley Kubrick', stars: ["Keir Dullea", "Gary Lockwood", "William Sylvester", "Daniel Richter"], plot: 'When a mysterious artifact is uncovered on the Moon, a spacecraft manned by two scientists and one supercomputer is dispatched to Jupiter to find its origins.' },
        { id: 'tt0105323', title: 'Scent of a Woman', year: 1992, rating: 8, runtime: '2h 36m', genres: ["Drama"], director: 'Martin Brest', stars: ["Al Pacino", "Chris O'Donnell", "James Rebhorn", "Gabrielle Anwar"], plot: 'A young prep student takes a job as an assistant to a blind, irritable, retired Army lieutenant colonel over Thanksgiving weekend.' },
        { id: 'tt0407887', title: 'The Departed', year: 2006, rating: 8.5, runtime: '2h 31m', genres: ["Crime", "Drama", "Thriller"], director: 'Martin Scorsese', stars: ["Leonardo DiCaprio", "Matt Damon", "Jack Nicholson", "Mark Wahlberg"], plot: 'An undercover cop and a mole in the police attempt to identify each other while infiltrating an Irish gang in South Boston.' },
        { id: 'tt0421715', title: 'The Curious Case of Benjamin Button', year: 2008, rating: 7.8, runtime: '2h 46m', genres: ["Drama", "Fantasy", "Romance"], director: 'David Fincher', stars: ["Brad Pitt", "Cate Blanchett", "Tilda Swinton", "Julia Ormond"], plot: 'Benjamin Button, born in 1918 with the physical state of an elderly man, ages in reverse. He experiences love and break-ups, ecstasy and sorrow, and timelessness by the time he dies in 2003 as a baby.' },
        { id: 'tt1954470', title: 'Gangs of Wasseypur', year: 2012, rating: 8.2, runtime: '5h 21m', genres: ["Action", "Comedy", "Crime"], director: 'Anurag Kashyap', stars: ["Manoj Bajpayee", "Nawazuddin Siddiqui", "Tigmanshu Dhulia", "Richa Chadha"], plot: 'A clash between Sultan and Shahid Khan leads to the expulsion of Khan from Wasseypur, and ignites a deadly blood feud spanning three generations.' },
        { id: 'tt1605783', title: 'Midnight in Paris', year: 2011, rating: 7.6, runtime: '1h 34m', genres: ["Comedy", "Fantasy", "Romance"], director: 'Woody Allen', stars: ["Owen Wilson", "Rachel McAdams", "Kathy Bates", "Kurt Fuller"], plot: 'While on a trip to Paris with his fianc├⌐e\'s family, a nostalgic screenwriter finds himself mysteriously going back to the 1920s every day at midnight.' },
        { id: 'tt6105098', title: 'The Lion King', year: 2019, rating: 6.8, runtime: '1h 58m', genres: ["Animation", "Adventure", "Drama"], director: 'Jon Favreau', stars: ["Donald Glover", "Beyonc\u251c\u2310", "Seth Rogen", "Chiwetel Ejiofor"], plot: 'After the murder of his father, a young lion prince flees his kingdom only to learn the true meaning of responsibility and bravery.' },
        { id: 'tt0213149', title: 'Pearl Harbor', year: 2001, rating: 6.3, runtime: '3h 3m', genres: ["Action", "Drama", "Romance"], director: 'Michael Bay', stars: ["Ben Affleck", "Kate Beckinsale", "Josh Hartnett", "William Lee Scott"], plot: 'Two lifelong friends and a beautiful nurse are caught up in the horror of an infamous Sunday morning in 1941.' },
        { id: 'tt2582846', title: 'The Fault in Our Stars', year: 2014, rating: 7.6, runtime: '2h 6m', genres: ["Drama", "Romance"], director: 'Josh Boone', stars: ["Shailene Woodley", "Ansel Elgort", "Nat Wolff", "Laura Dern"], plot: 'Hazel and Gus are teenagers who meet at a cancer support group and fall in love. They both share the same acerbic wit and a love of books, especially \"An Imperial Affliction\", so they embark on a journey to visit an author in Amsterdam.' },
        { id: 'tt1853728', title: 'Django Unchained', year: 2012, rating: 8.5, runtime: '2h 45m', genres: ["Drama", "Western"], director: 'Quentin Tarantino', stars: ["Jamie Foxx", "Christoph Waltz", "Leonardo DiCaprio", "Kerry Washington"], plot: 'With the help of a German bounty-hunter, a freed slave sets out to rescue his wife from a brutal plantation owner in Mississippi.' },
        { id: 'tt0450259', title: 'Blood Diamond', year: 2006, rating: 8, runtime: '2h 23m', genres: ["Adventure", "Drama", "Thriller"], director: 'Edward Zwick', stars: ["Leonardo DiCaprio", "Djimon Hounsou", "Jennifer Connelly", "Kagiso Kuypers"], plot: 'A fisherman, a smuggler, and a syndicate of businessmen match wits over the possession of a priceless diamond.' },
        { id: 'tt0119381', title: 'Inventing the Abbotts', year: 1997, rating: 6.4, runtime: '1h 50m', genres: ["Drama", "Romance"], director: 'Pat O\'Connor', stars: ["Liv Tyler", "Jennifer Connelly", "Joaquin Phoenix", "Billy Crudup"], plot: 'Two working class brothers court three wealthy and beautiful sisters in a small Illinois town.' },
        { id: 'tt3215824', title: 'Those Who Wish Me Dead', year: 2021, rating: 6, runtime: '1h 40m', genres: ["Action", "Thriller"], director: 'Taylor Sheridan', stars: ["Angelina Jolie", "Nicholas Hoult", "Finn Little", "Jon Bernthal"], plot: 'A teenage murder witness finds himself pursued by twin assassins in the Montana wilderness with a survival expert tasked with protecting him -- and a forest fire threatening to consume them all.' },
        { id: 'tt7598076', title: 'Curiosa', year: 2019, rating: 5.4, runtime: '1h 47m', genres: ["Biography", "Drama", "History"], director: 'Lou Jeunet', stars: ["No\u251c\u2310mie Merlant", "Niels Schneider", "Benjamin Lavernhe", "Cam\u251c\u2310lia Jordana"], plot: 'A passionate love story set against a backdrop of sexual freedom, loosely based on the relationship between 19th-century authors Pierre Lou├┐s and Marie de R├⌐gnier.' },
        { id: 'tt0443706', title: 'Zodiac', year: 2007, rating: 7.7, runtime: '2h 37m', genres: ["Crime", "Drama", "Mystery"], director: 'David Fincher', stars: ["Jake Gyllenhaal", "Robert Downey Jr.", "Mark Ruffalo", "Anthony Edwards"], plot: 'Between 1968 and 1983, a San Francisco cartoonist becomes an amateur detective obsessed with tracking down the Zodiac Killer, an unidentified individual who terrorizes Northern California with a killing spree.' },
        { id: 'tt1291465', title: 'Raajneeti', year: 2010, rating: 7.1, runtime: '2h 43m', genres: ["Drama", "Thriller"], director: '', stars: ["Ajay Devgn", "Ranbir Kapoor", "Nana Patekar", "Katrina Kaif"], plot: 'Samar, the son of a political family, has chosen to go to the USA to live with his girlfriend. However, the death of his father makes him put his plans on hold and enter the dirty world of politics.' },
        { id: 'tt0119217', title: 'Good Will Hunting', year: 1997, rating: 8.4, runtime: '2h 6m', genres: ["Drama", "Romance"], director: 'Gus Van Sant', stars: ["Robin Williams", "Matt Damon", "Ben Affleck", "Stellan Skarsg\u251c\u00d1rd"], plot: 'A therapist counsels Will Hunting, a janitor with a genius IQ.' },
        { id: 'tt7888964', title: 'Nobody', year: 2021, rating: 7.4, runtime: '1h 32m', genres: ["Action", "Crime", "Drama"], director: 'Ilya Naishuller', stars: ["Bob Odenkirk", "Aleksey Serebryakov", "Connie Nielsen", "Christopher Lloyd"], plot: 'A docile family man slowly reveals his true character after his house gets burgled by two petty thieves, which, coincidentally, leads him into a bloody war with a Russian crime boss.' },
        { id: 'tt1663202', title: 'The Revenant', year: 2015, rating: 8, runtime: '2h 36m', genres: ["Action", "Drama", "Western"], director: 'Alejandro G. I├▒├írritu', stars: ["Leonardo DiCaprio", "Tom Hardy", "Will Poulter", "Domhnall Gleeson"], plot: 'A frontiersman on a fur trading expedition in the 1820s fights for survival after being mauled by a bear and left for dead by members of his own hunting team.' },
        { id: 'tt0112471', title: 'Before Sunrise', year: 1995, rating: 8.1, runtime: '1h 41m', genres: ["Comedy", "Drama", "Romance"], director: 'Richard Linklater', stars: ["Ethan Hawke", "Julie Delpy", "Andrea Eckert", "Hanno P\u251c\u2562schl"], plot: 'A young man and woman meet on a train in Europe, and wind up spending one evening together in Vienna. Unfortunately, both know that this will probably be their only night together.' },
        { id: 'tt0381681', title: 'Before Sunset', year: 2004, rating: 8.1, runtime: '1h 20m', genres: ["Drama", "Romance"], director: 'Richard Linklater', stars: ["Ethan Hawke", "Julie Delpy", "Vernon Dobtcheff", "Louise Lemoine Torr\u251c\u00bfs"], plot: 'Nine years after Jesse and Celine first met, they encounter each other again on the French leg of Jesse\'s book tour.' },
        { id: 'tt2209418', title: 'Before Midnight', year: 2013, rating: 7.9, runtime: '1h 49m', genres: ["Drama", "Romance"], director: 'Richard Linklater', stars: ["Ethan Hawke", "Julie Delpy", "Seamus Davey-Fitzpatrick", "Jennifer Prior"], plot: 'We meet Jesse and Celine nine years on in Greece. Almost two decades have passed since their first meeting on that train bound for Vienna.' },
        { id: 'tt0434409', title: 'V for Vendetta', year: 2005, rating: 8.1, runtime: '2h 12m', genres: ["Action", "Drama", "Sci-Fi"], director: 'James McTeigue', stars: ["Hugo Weaving", "Natalie Portman", "Rupert Graves", "Stephen Rea"], plot: 'A young woman living in a dystopian society meets a shadowy freedom fighter who is plotting to overthrow their tyrannical government.' },
        { id: 'tt0075314', title: 'Taxi Driver', year: 1976, rating: 8.2, runtime: '1h 54m', genres: ["Crime", "Drama"], director: 'Martin Scorsese', stars: ["Robert De Niro", "Jodie Foster", "Cybill Shepherd", "Diahnne Abbott"], plot: 'A mentally unstable veteran works as a nighttime taxi driver in New York City, where the perceived decadence and sleaze fuels his urge for violent action.' },
        { id: 'tt0396171', title: 'Perfume: The Story of a Murderer', year: 2006, rating: 7.5, runtime: '2h 27m', genres: ["Crime", "Drama", "Fantasy"], director: 'Tom Tykwer', stars: ["Ben Whishaw", "Dustin Hoffman", "Alan Rickman", "Francesc Albiol"], plot: 'Jean-Baptiste Grenouille, born with a superior olfactory sense, creates the world\'s finest perfume. His work, however, takes a dark turn as he searches for the ultimate scent.' },
        { id: 'tt0118799', title: 'Life Is Beautiful', year: 1997, rating: 8.6, runtime: '1h 56m', genres: ["Comedy", "Drama", "Romance"], director: 'Roberto Benigni', stars: ["Roberto Benigni", "Nicoletta Braschi", "Giorgio Cantarini", "Giustino Durano"], plot: 'When an open-minded Jewish waiter and his son become victims of the Holocaust, he uses a perfect mixture of will, humor and imagination to protect his son from the dangers around their camp.' },
        { id: 'tt1832382', title: 'A Separation', year: 2011, rating: 8.3, runtime: '2h 3m', genres: ["Drama"], director: 'Asghar Farhadi', stars: ["Payman Maadi", "Leila Hatami", "Sareh Bayat", "Shahab Hosseini"], plot: 'A married couple have to decide whether to improve their daughter\'s life by moving abroad or to stay in Iran and look after a deteriorating parent with Alzheimer\'s disease.' },
        { id: 'tt0361862', title: 'The Machinist', year: 2004, rating: 7.6, runtime: '1h 41m', genres: ["Drama", "Thriller"], director: 'Brad Anderson', stars: ["Christian Bale", "Jennifer Jason Leigh", "Aitana S\u251c\u00ednchez-Gij\u251c\u2502n", "John Sharian"], plot: 'An industrial worker who hasn\'t slept in a year begins to doubt his own sanity.' },
        { id: 'tt0040522', title: 'Bicycle Thieves', year: 1948, rating: 8.2, runtime: '1h 29m', genres: ["Drama"], director: 'Vittorio De Sica', stars: ["Lamberto Maggiorani", "Enzo Staiola", "Lianella Carell", "Elena Altieri"], plot: 'In post-war Italy, a working-class man\'s bicycle is stolen, endangering his efforts to find work. He and his son set out to find it.' },
        { id: 'tt0114369', title: 'Seven', year: 1995, rating: 8.6, runtime: '2h 7m', genres: ["Crime", "Drama", "Mystery"], director: 'David Fincher', stars: ["Morgan Freeman", "Brad Pitt", "Kevin Spacey", "Andrew Kevin Walker"], plot: 'Two detectives try to track down a serial killer who chooses his victims based on the Seven Deadly Sins.' },
        { id: 'tt0045810', title: 'Gentlemen Prefer Blondes', year: 1953, rating: 7.1, runtime: '1h 31m', genres: ["Comedy", "Musical", "Romance"], director: 'Howard Hawks', stars: ["Jane Russell", "Marilyn Monroe", "Charles Coburn", "Elliott Reid"], plot: 'Showgirls Lorelei Lee and Dorothy Shaw travel to Paris, pursued by a private detective hired by the suspicious father of Lorelei\'s fianc├⌐, as well as a rich, enamored old man and many other doting admirers.' },
        { id: 'tt8613070', title: 'Portrait of a Lady on Fire', year: 2019, rating: 8, runtime: '2h 2m', genres: ["Drama", "Romance"], director: 'C├⌐line Sciamma', stars: ["No\u251c\u2310mie Merlant", "Ad\u251c\u00bfle Haenel", "Lu\u251c\u00e1na Bajrami", "Valeria Golino"], plot: 'On an isolated island in Brittany at the end of the eighteenth century, a female painter is obliged to paint a wedding portrait of a young woman.' },
        { id: 'tt0120586', title: 'American History X', year: 1998, rating: 8.5, runtime: '1h 59m', genres: ["Crime", "Drama"], director: 'Tony Kaye', stars: ["Edward Norton", "Edward Furlong", "Beverly D'Angelo", "Jennifer Lien"], plot: 'A neo-Nazi is released from prison a changed man and hopes to prevent his younger brother from following in his footsteps.' },
        { id: 'tt1517451', title: 'A Star Is Born', year: 2018, rating: 7.6, runtime: '2h 16m', genres: ["Drama", "Music", "Romance"], director: 'Bradley Cooper', stars: ["Lady Gaga", "Bradley Cooper", "Sam Elliott", "Andrew Dice Clay"], plot: 'A hard-drinking country music star falls in love with a singer whose career quickly takes off.' },
        { id: 'tt0118849', title: 'Children of Heaven', year: 1997, rating: 8.2, runtime: '1h 29m', genres: ["Drama", "Family", "Sport"], director: 'Majid Majidi', stars: ["Reza Naji", "Amir Farrokh Hashemian", "Bahare Seddiqi", "Nafise Jafar-Mohammadi"], plot: 'After a boy loses his sister\'s pair of shoes, he goes on a series of adventures in order to find them. When he can\'t, he tries a new way to \"win\" a new pair.' },
        { id: 'tt0993846', title: 'The Wolf of Wall Street', year: 2013, rating: 8.2, runtime: '3h 0m', genres: ["Biography", "Comedy", "Crime"], director: 'Martin Scorsese', stars: ["Leonardo DiCaprio", "Jonah Hill", "Margot Robbie", "Matthew McConaughey"], plot: 'Based on the true story of Jordan Belfort, from his rise to a wealthy stock-broker living the high life to his fall involving crime, corruption and the federal government.' },
        { id: 'tt1130884', title: 'Shutter Island', year: 2010, rating: 8.2, runtime: '2h 18m', genres: ["Mystery", "Thriller"], director: 'Martin Scorsese', stars: ["Leonardo DiCaprio", "Emily Mortimer", "Mark Ruffalo", "Ben Kingsley"], plot: 'Two US Marshals are sent to a mental institution on an inhospitable island to investigate the disappearance of a patient.' },
        { id: 'tt1798709', title: 'Her', year: 2013, rating: 7.9, runtime: '2h 6m', genres: ["Drama", "Romance", "Sci-Fi"], director: 'Spike Jonze', stars: ["Joaquin Phoenix", "Amy Adams", "Scarlett Johansson", "Lynn Adrianna Freedman"], plot: 'In the near future, a lonely writer develops an unlikely relationship with an operating system designed to meet his every need.' },
        { id: 'tt0095327', title: 'Grave of the Fireflies', year: 1988, rating: 8.5, runtime: '1h 28m', genres: ["Animation", "Drama", "War"], director: 'Isao Takahata', stars: ["Tsutomu Tatsumi", "Ayano Shiraishi", "Akemi Yamaguchi", "Yoshiko Shinohara"], plot: 'A young boy and his little sister struggle to survive in Japan during World War II.' },
        { id: 'tt0086250', title: 'Scarface', year: 1983, rating: 8.3, runtime: '2h 50m', genres: ["Crime", "Drama"], director: 'Brian De Palma', stars: ["Al Pacino", "Michelle Pfeiffer", "Steven Bauer", "Mary Elizabeth Mastrantonio"], plot: 'In the 1980s, a determined criminal-minded Cuban immigrant becomes the biggest drug smuggler in Miami, and is eventually undone by his own drug addiction.' },
        { id: 'tt3682448', title: 'Bridge of Spies', year: 2015, rating: 7.6, runtime: '2h 22m', genres: ["Drama", "History", "Thriller"], director: 'Steven Spielberg', stars: ["Tom Hanks", "Mark Rylance", "Alan Alda", "Domenick Lombardozzi"], plot: 'During the Cold War, an American lawyer is recruited to defend an arrested Soviet spy in court, and then help the CIA facilitate an exchange of the spy for the Soviet captured American U2 spy plane pilot, Francis Gary Powers.' },
        { id: 'tt0050083', title: '12 Angry Men', year: 1957, rating: 9, runtime: '1h 36m', genres: ["Crime", "Drama"], director: 'Sidney Lumet', stars: ["Henry Fonda", "Lee J. Cobb", "Martin Balsam", "John Fiedler"], plot: 'The jury in a New York City murder trial is frustrated by a single member whose skeptical caution forces them to more carefully consider the evidence before jumping to a hasty verdict.' },
        { id: 'tt0268978', title: 'A Beautiful Mind', year: 2001, rating: 8.2, runtime: '2h 15m', genres: ["Biography", "Drama", "Mystery"], director: 'Ron Howard', stars: ["Russell Crowe", "Ed Harris", "Jennifer Connelly", "Christopher Plummer"], plot: 'A mathematical genius, John Nash made an astonishing discovery early in his career and stood on the brink of international acclaim. But Nash soon found himself on a harrowing journey of self-discovery.' },
        { id: 'tt0162222', title: 'Cast Away', year: 2000, rating: 7.8, runtime: '2h 23m', genres: ["Adventure", "Drama", "Romance"], director: 'Robert Zemeckis', stars: ["Tom Hanks", "Helen Hunt", "Paul Sanchez", "Lari White"], plot: 'A FedEx executive undergoes a physical and emotional transformation after crash landing on a deserted island.' },
        { id: 'tt1515091', title: 'Sherlock Holmes: A Game of Shadows', year: 2011, rating: 7.4, runtime: '2h 9m', genres: ["Action", "Adventure", "Mystery"], director: 'Guy Ritchie', stars: ["Robert Downey Jr.", "Jude Law", "Jared Harris", "Noomi Rapace"], plot: 'Detective Sherlock Holmes is on the trail of criminal mastermind Professor Moriarty, who is carrying out a string of random crimes across Europe.' },
        { id: 'tt0988045', title: 'Sherlock Holmes', year: 2009, rating: 7.5, runtime: '2h 8m', genres: ["Action", "Adventure", "Mystery"], director: 'Guy Ritchie', stars: ["Robert Downey Jr.", "Jude Law", "Rachel McAdams", "Mark Strong"], plot: 'Detective Sherlock Holmes and his stalwart partner Watson engage in a battle of wits and brawn with a nemesis whose plot is a threat to all of England.' },
        { id: 'tt0477348', title: 'No Country for Old Men', year: 2007, rating: 8.2, runtime: '2h 2m', genres: ["Crime", "Drama", "Thriller"], director: '', stars: ["Tommy Lee Jones", "Javier Bardem", "Josh Brolin", "Woody Harrelson"], plot: 'Violence and mayhem ensue after a hunter stumbles upon the aftermath of a drug deal gone wrong and over two million dollars in cash near the Rio Grande.' },
        { id: 'tt0482571', title: 'The Prestige', year: 2006, rating: 8.5, runtime: '2h 10m', genres: ["Drama", "Mystery", "Sci-Fi"], director: 'Christopher Nolan', stars: ["Christian Bale", "Hugh Jackman", "Scarlett Johansson", "Michael Caine"], plot: 'Two magicians dismantle their lives to outmaneuver each other following a shared tragedy. They chase the ultimate illusion across Victorian London, sacrificing sanity and safety to master a teleportation feat that defies all logic.' },
        { id: 'tt1375666', title: 'Inception', year: 2010, rating: 8.8, runtime: '2h 28m', genres: ["Adventure", "Sci-Fi", "Thriller"], director: 'Christopher Nolan', stars: ["Leonardo DiCaprio", "Joseph Gordon-Levitt", "Elliot Page", "Tom Hardy"], plot: 'A thief who steals corporate secrets through the use of dream-sharing technology is given the inverse task of planting an idea into the mind of a CEO, but his tragic past may doom the project and his team to disaster.' },
        { id: 'tt0372784', title: 'Batman Begins', year: 2005, rating: 8.2, runtime: '2h 20m', genres: ["Crime"], director: 'Christopher Nolan', stars: ["Christian Bale", "Michael Caine", "Ken Watanabe", "Liam Neeson"], plot: 'After witnessing his parents\' death, billionaire Bruce Wayne learns the art of fighting to confront injustice. When he returns to Gotham as Batman, he must stop a secret society that intends to destroy the city.' },
        { id: 'tt0468569', title: 'The Dark Knight', year: 2008, rating: 9.1, runtime: '2h 32m', genres: ["Crime", "Thriller"], director: 'Christopher Nolan', stars: ["Christian Bale", "Heath Ledger", "Aaron Eckhart", "Michael Caine"], plot: 'When a menace known as the Joker wreaks havoc and chaos on the people of Gotham, Batman, James Gordon and Harvey Dent must work together to put an end to the madness.' },
        { id: 'tt1345836', title: 'The Dark Knight Rises', year: 2012, rating: 8.4, runtime: '2h 44m', genres: ["Crime", "Thriller"], director: 'Christopher Nolan', stars: ["Christian Bale", "Tom Hardy", "Anne Hathaway", "Gary Oldman"], plot: 'Bane, an imposing terrorist, attacks Gotham City and disrupts its eight-year-long period of peace. This forces Bruce Wayne to come out of hiding and don the cape and cowl of Batman again.' },
        { id: 'tt3783958', title: 'La La Land', year: 2016, rating: 8, runtime: '2h 8m', genres: ["Comedy", "Drama", "Music"], director: 'Damien Chazelle', stars: ["Ryan Gosling", "Emma Stone", "Rosemarie DeWitt", "Amiee Conn"], plot: 'When Sebastian, a pianist, and Mia, an actress, follow their passion and achieve success in their respective fields, they find themselves torn between their love for each other and their careers.' },
        { id: 'tt0362227', title: 'The Terminal', year: 2004, rating: 7.4, runtime: '2h 8m', genres: ["Comedy", "Drama", "Romance"], director: 'Steven Spielberg', stars: ["Tom Hanks", "Catherine Zeta-Jones", "Chi McBride", "Stanley Tucci"], plot: 'An Eastern European tourist unexpectedly finds himself stranded at JFK airport and must take up temporary residence there.' },
        { id: 'tt0264464', title: 'Catch Me If You Can', year: 2002, rating: 8.1, runtime: '2h 21m', genres: ["Biography", "Crime", "Drama"], director: 'Steven Spielberg', stars: ["Leonardo DiCaprio", "Tom Hanks", "Christopher Walken", "Martin Sheen"], plot: 'A runaway teenager lives an exciting life by forging checks and impersonating several professions, but his fraudulent activities soon attract the attention of the FBI.' },
        { id: 'tt0332452', title: 'Troy', year: 2004, rating: 7.3, runtime: '2h 43m', genres: ["Action", "Adventure"], director: 'Wolfgang Petersen', stars: ["Brad Pitt", "Eric Bana", "Orlando Bloom", "Julian Glover"], plot: 'An adaptation of Homer\'s great epic, the film follows the assault on Troy by the united Greek forces.' },
        { id: 'tt0120815', title: 'Saving Private Ryan', year: 1998, rating: 8.6, runtime: '2h 49m', genres: ["Drama", "War"], director: 'Steven Spielberg', stars: ["Tom Hanks", "Matt Damon", "Tom Sizemore", "Edward Burns"], plot: 'Following the Normandy Landings, a group of U.S. soldiers go behind enemy lines to retrieve a paratrooper whose brothers have been killed in action.' },
        { id: 'tt1950186', title: 'Ford v Ferrari', year: 2019, rating: 8.1, runtime: '2h 32m', genres: ["Action", "Biography", "Drama"], director: 'James Mangold', stars: ["Matt Damon", "Christian Bale", "Jon Bernthal", "Caitr\u251c\u00a1ona Balfe"], plot: 'American car designer Carroll Shelby and driver Ken Miles battle corporate interference and the laws of physics to build a revolutionary race car for Ford in order to defeat Ferrari at the 24 Hours of Le Mans in 1966.' },
        { id: 'tt6468322', title: 'Money Heist', year: 2017, rating: 8.2, runtime: '1h 0m', genres: ["Action", "Crime", "Drama"], director: '', stars: ["\u251c\u00dcrsula Corber\u251c\u2502", "\u251c\u00fclvaro Morte", "Itziar Itu\u251c\u2592o", "Pedro Alonso"], plot: 'An unusual group of robbers attempts to carry out the most perfect robbery in Spanish history: stealing 2.4 billion euros from the Royal Mint of Spain.' },
        { id: 'tt0455275', title: 'Prison Break', year: 2005, rating: 8.3, runtime: '0h 44m', genres: ["Action", "Crime", "Drama"], director: '', stars: ["Dominic Purcell", "Wentworth Miller", "Amaury Nolasco", "Robert Knepper"], plot: 'A structural engineer installs himself in a prison his company helped design, to save his falsely accused brother from a death sentence by breaking both of them out from the inside.' },
        { id: 'tt0903747', title: 'Breaking Bad', year: 2008, rating: 9.5, runtime: '0h 48m', genres: ["Crime", "Drama", "Thriller"], director: '', stars: ["Bryan Cranston", "Aaron Paul", "Anna Gunn", "Dean Norris"], plot: 'A chemistry teacher diagnosed with inoperable lung cancer turns to manufacturing and selling methamphetamine with a former student to secure his family\'s future.' },
        { id: 'tt2707408', title: 'Narcos', year: 2015, rating: 8.7, runtime: '0h 50m', genres: ["Biography", "Crime", "Drama"], director: '', stars: ["Pedro Pascal", "Wagner Moura", "Boyd Holbrook", "Alberto Ammann"], plot: 'A chronicled look at the criminal exploits of Colombian drug lord Pablo Escobar, as well as the many other drug kingpins who plagued the country through the years.' },
        { id: 'tt5753856', title: 'Dark', year: 2017, rating: 8.7, runtime: '1h 0m', genres: ["Crime", "Drama", "Mystery"], director: '', stars: ["Louis Hofmann", "Karoline Eichhorn", "Lisa Vicari", "Maja Sch\u251c\u2562ne"], plot: 'A family saga with a supernatural twist, set in a German town where the disappearance of two young children exposes the relationships among four families.' },
        { id: 'tt0108052', title: 'Schindler\'s List', year: 1993, rating: 9, runtime: '3h 16m', genres: ["Biography", "Drama", "History"], director: 'Steven Spielberg', stars: ["Liam Neeson", "Ralph Fiennes", "Ben Kingsley", "Caroline Goodall"], plot: 'In German-occupied Poland during World War II, industrialist Oskar Schindler gradually becomes concerned for his Jewish workforce after witnessing their persecution by the Nazis.' },
        { id: 'tt0137523', title: 'Fight Club', year: 1999, rating: 8.8, runtime: '2h 19m', genres: ["Crime", "Drama", "Thriller"], director: 'David Fincher', stars: ["Brad Pitt", "Edward Norton", "Meat Loaf", "Zach Grenier"], plot: 'An insomniac office worker and a devil-may-care soap maker form an underground fight club that evolves into much more.' },
        { id: 'tt1355644', title: 'Passengers', year: 2016, rating: 7, runtime: '1h 56m', genres: ["Drama", "Romance", "Sci-Fi"], director: 'Morten Tyldum', stars: ["Jennifer Lawrence", "Chris Pratt", "Michael Sheen", "Laurence Fishburne"], plot: 'A malfunction in a sleeping pod on a spacecraft traveling to a distant colony planet wakes one passenger 90 years early.' },
        { id: 'tt2267998', title: 'Gone Girl', year: 2014, rating: 8.1, runtime: '2h 29m', genres: ["Drama", "Mystery", "Thriller"], director: 'David Fincher', stars: ["Ben Affleck", "Rosamund Pike", "Neil Patrick Harris", "Tyler Perry"], plot: 'The husband of a missing woman becomes the main suspect in her disappearance.' },
        { id: 'tt0120689', title: 'The Green Mile', year: 1999, rating: 8.6, runtime: '3h 9m', genres: ["Crime", "Drama", "Fantasy"], director: 'Frank Darabont', stars: ["Tom Hanks", "Michael Clarke Duncan", "David Morse", "Bonnie Hunt"], plot: 'A death row guard learns that a gentle giant in his charge possesses a mysterious gift.' },
        { id: 'tt0068646', title: 'The Godfather', year: 1972, rating: 9.2, runtime: '2h 55m', genres: ["Crime", "Drama"], director: 'Francis Ford Coppola', stars: ["Marlon Brando", "Al Pacino", "James Caan", "Richard S. Castellano"], plot: 'The aging patriarch of an organized crime dynasty transfers control of his clandestine empire to his reluctant son.' },
        { id: 'tt0071562', title: 'The Godfather Part II', year: 1974, rating: 9, runtime: '3h 22m', genres: ["Crime", "Drama"], director: 'Francis Ford Coppola', stars: ["Al Pacino", "Robert De Niro", "Robert Duvall", "Diane Keaton"], plot: 'The early life and career of Vito Corleone in 1920s New York City is portrayed, while his son, Michael, expands and tightens his grip on the family crime syndicate.' },
        { id: 'tt0099674', title: 'The Godfather Part III', year: 1990, rating: 7.5, runtime: '2h 42m', genres: ["Crime", "Drama"], director: 'Francis Ford Coppola', stars: ["Al Pacino", "Diane Keaton", "Andy Garcia", "Talia Shire"], plot: 'Follows Michael Corleone, now in his 60s, as he seeks to free his family from crime and find a suitable successor to his empire.' },
        { id: 'tt8936646', title: 'Extraction', year: 2020, rating: 6.8, runtime: '1h 56m', genres: ["Action", "Crime", "Thriller"], director: 'Sam Hargrave', stars: ["Chris Hemsworth", "Bryon Lerum", "Ryder Lerum", "Rudhraksh Jaiswal"], plot: 'Tyler Rake, a fearless black market mercenary, embarks on the most deadly extraction of his career when he\'s enlisted to rescue the kidnapped son of an imprisoned international crime lord.' },
        { id: 'tt8108198', title: 'Andhadhun', year: 2018, rating: 8.2, runtime: '2h 19m', genres: ["Comedy", "Crime", "Mystery"], director: 'Sriram Raghavan', stars: ["Ayushmann Khurrana", "Tabu", "Radhika Apte", "Anil Dhawan"], plot: 'A series of mysterious events change the life of a blind pianist, who must now report a crime that he should technically know nothing of.' },
        { id: 'tt8665746', title: 'RX 100', year: 2018, rating: 6.9, runtime: '2h 33m', genres: ["Action"], director: 'Ajay Bhupathi', stars: ["Kartikeya Gummakonda", "Payal Rajput", "Ramki", "Rao Ramesh"], plot: 'Shiva, a village youth, falls in love with city-bred girl Indu, but things don\'t go as planned. Indu marries and leaves for the USA, but Shiva waits three years for her. One day, she returns to their village, but does Shiva get her back?' },
        { id: 'tt1514446', title: 'Third Person Singular Number', year: 2009, rating: 7.1, runtime: '2h 4m', genres: ["Drama"], director: 'Mostofa Sarwar Farooki', stars: ["Nusrat Imrose Tisha", "Mosharraf Karim", "Rashed Uddin Ahmed Topu", "Abul Hayat"], plot: 'A woman breaks with traditional Muslim culture by living with her boyfriend before getting married, but when the relationship ends, she must face the harsh consequences of being an outcast in her community.' },
        { id: 'tt1621830', title: 'Monpura', year: 2009, rating: 8.7, runtime: '2h 16m', genres: ["Crime", "Drama", "Musical"], director: '', stars: ["Chanchal Chowdhury", "Farhana Mili", "Shirin Alam", "Mohiuddin Bahar"], plot: 'A housemaid is killed by a local landlord\'s son. His servant takes the blame for the murder, to save the landlord\'s mentally ill son and is marooned in an island named Monpura. There the servant comes across a fisherman\'s daughter.' },
        { id: 'tt5510934', title: 'The Unnamed', year: 2016, rating: 8.9, runtime: '1h 40m', genres: ["Drama"], director: 'Tauquir Ahmed', stars: ["Shahiduzzaman Selim", "Ashraful Tushar", "Mosharraf Karim", "Nipun"], plot: 'The coffin of an expatriate worker with manipulated identity intense the identity crisis when another person\'s corpse is found inside.' },
        { id: 'tt3982254', title: 'Mad_e in Bangladesh', year: 2007, rating: 8.2, runtime: '1h 46m', genres: ["Comedy", "Drama"], director: 'Mostofa Sarwar Farooki', stars: ["Zahid Hasan", "Shahiduzzaman Selim", "Tariq Anam Khan", "Masud Ali Khan"], plot: 'An apparently passive young man, Khorshed (Zahid Hasan), comes to Dhaka from a rural area looking for a job and a better life. He gets to stay with an uncle (Ahsanul Haq Minu) who literally robs him off every penny he has. A beautiful, flirtatious married woman next door (Rosey Siddiqui) is like a breath of fresh air in this hellhole. Khorshed is soon seen walking into a government bungalow, threatening an unsuspecting DC (Tariq Anam Khan) of Ratanpur and his PA (Shahiduzzaman Selim) that he is armed with a bomb (in a briefcase) and is not afraid to detonate it. Holding the government officials at gunpoint, he asks them to call up influential individuals of the region, including the SP (Masud Ali Khan) and ASP (Hasan Masood), leader of a youth organisation (Marzuk Russell), a leading cultural activist (Fazlur Rahman Babu), political leaders belonging to rival parties (Jayanto Chattopadhyay and Saleh Ahmed) and educationists (Amirul Haque Chowdhury and Tania Ahmed). After they all arrive, thinking they have been called upon to attend an urgent meeting with the DC, Khorshed makes his intentions clear. He reads out an eight-point demand and wants the parliament to pass new legislation to put an end to corruption.' },
        { id: 'tt5354160', title: 'Mirror Game', year: 2016, rating: 8.8, runtime: '2h 27m', genres: ["Crime", "Mystery", "Thriller"], director: 'Amitabh Reza Chowdhury', stars: ["Chanchal Chowdhury", "Masuma Rahman Nabila", "Partha Barua", "Lutfur Rahman George"], plot: 'A struggling actor becomes a professional impostor, hired to impersonate people for financial gain, but as he delves deeper into his work he becomes embroiled in trouble that threatens to unravel his life.' },
        { id: 'tt10928202', title: 'Hawa', year: 2022, rating: 7.6, runtime: '2h 11m', genres: ["Drama", "Mystery"], director: 'Mejbaur Rahman Sumon', stars: ["Chanchal Chowdhury", "Nazifa Tushi", "Rizvi Rizu", "Nasir Uddin Khan"], plot: 'Story of a group of seasoned fishermen who discover a beautiful young woman caught in their net. Her presence in the boat causes tensions among the crew and seems to be connected to a shortage of fish.' },
        { id: 'tt7838252', title: 'K.G.F: Chapter 1', year: 2018, rating: 8.1, runtime: '2h 34m', genres: ["Action", "Crime", "Drama"], director: 'Prashanth Neel', stars: ["Yash", "Srinidhi Shetty", "Garuda Ram", "Archana Jois"], plot: 'In the 1970s, a gangster named Rocky goes undercover as a slave to assassinate the owner of a notorious gold mine known as the Kolar Gold Fields.' },
        { id: 'tt1528100', title: 'Exodus: Gods and Kings', year: 2014, rating: 6, runtime: '2h 30m', genres: ["Action", "Adventure", "Drama"], director: 'Ridley Scott', stars: ["Christian Bale", "Joel Edgerton", "Ben Kingsley", "John Turturro"], plot: 'The defiant leader Moses rises up against Egyptian Pharaoh Ramses II, setting six hundred thousand slaves on a monumental journey of escape from Egypt and its terrifying cycle of deadly plagues.' },
        { id: 'tt0289879', title: 'The Butterfly Effect', year: 2004, rating: 7.6, runtime: '1h 53m', genres: ["Drama", "Sci-Fi", "Thriller"], director: '', stars: ["Ashton Kutcher", "Amy Smart", "Melora Walters", "Elden Henson"], plot: 'A boy suffers blackouts during traumatic events, but in college he finds a way to travel back in time to those moments and alter the course of his life.' },
        { id: 'tt2911666', title: 'John Wick', year: 2014, rating: 7.5, runtime: '1h 41m', genres: ["Action", "Crime", "Thriller"], director: 'Chad Stahelski', stars: ["Keanu Reeves", "Michael Nyqvist", "Alfie Allen", "Willem Dafoe"], plot: 'John Wick is a former hitman grieving the loss of his true love. When his home is broken into, robbed, and his dog killed, he is forced to return to action to exact revenge.' },
        { id: 'tt11912196', title: 'Asur: Welcome to Your Dark Side', year: 2020, rating: 8.4, runtime: '0h 43m', genres: ["Crime", "Drama", "Mystery"], director: '', stars: ["Arshad Warsi", "Barun Sobti", "Anupriya Goenka", "Ridhi Dogra"], plot: 'Shubh returns for revenge and this season he takes the challenge to a whole new level. With the heroes fallen apart, will a desolate Dhananjay Rajpoot and a torn Nikhil Nair be able to stop him?' },
        { id: 'tt0290673', title: 'Irreversible', year: 2002, rating: 7.3, runtime: '1h 37m', genres: ["Crime", "Drama", "Mystery"], director: 'Gaspar No├⌐', stars: ["Monica Bellucci", "Vincent Cassel", "Albert Dupontel", "Philippe Nahon"], plot: 'Events over the course of one traumatic night in Paris unfold in reverse-chronological order.' },
        { id: 'tt0947798', title: 'Black Swan', year: 2010, rating: 8, runtime: '1h 48m', genres: ["Drama", "Thriller"], director: 'Darren Aronofsky', stars: ["Natalie Portman", "Mila Kunis", "Vincent Cassel", "Barbara Hershey"], plot: 'An insecure ballerina finally gets the role she has always dreamed of, but as the pressures mount her line between reality and illusion starts to blur.' },
        { id: 'tt0454876', title: 'Life of Pi', year: 2012, rating: 7.9, runtime: '2h 7m', genres: ["Adventure", "Drama", "Family"], director: 'Ang Lee', stars: ["Suraj Sharma", "Irrfan Khan", "Ayush Tandon", "Gautam Belur"], plot: 'A young man who survives a disaster at sea is hurtled into an epic journey of adventure and discovery. While cast away, he forms an unexpected connection with another survivor: a fearsome Bengal tiger.' },
        { id: 'tt0242519', title: 'Hera Pheri', year: 2000, rating: 8.2, runtime: '2h 36m', genres: ["Action", "Comedy", "Crime"], director: 'Priyadarshan', stars: ["Akshay Kumar", "Suniel Shetty", "Paresh Rawal", "Tabu"], plot: 'Two tenants and a landlord look for answers to all their money problems - but when their opportunity arrives, will they know what to do with it?' },
        { id: 'tt0419058', title: 'Phir Hera Pheri', year: 2006, rating: 7.4, runtime: '2h 33m', genres: ["Comedy", "Crime"], director: 'Neeraj Vora', stars: ["Akshay Kumar", "Suniel Shetty", "Paresh Rawal", "Bipasha Basu"], plot: 'A twist of fate changes the lives of Raju, Shyam and Baburao when they get cheated by a fraudster. They must now find a way to repay a loan taken from a dreaded gangster.' },
        { id: 'tt6452574', title: 'Sanju', year: 2018, rating: 7.6, runtime: '2h 35m', genres: ["Biography", "Comedy", "Drama"], director: 'Rajkumar Hirani', stars: ["Ranbir Kapoor", "Paresh Rawal", "Manisha Koirala", "Vicky Kaushal"], plot: 'Follows Bollywood star Sanjay Dutt\'s turbulent journey through fame, personal struggles, and legal troubles that led to his imprisonment.' },
        { id: 'tt2356180', title: 'Bhaag Milkha Bhaag', year: 2013, rating: 8.2, runtime: '3h 6m', genres: ["Biography", "Drama", "Sport"], director: 'Rakeysh Omprakash Mehra', stars: ["Farhan Akhtar", "Kousi Orfahli", "Deepak Singh Rawat", "Japtej Singh"], plot: 'The truth behind the ascension of Milkha Singh, who was scarred by of the India-Pakistan partition.' },
        { id: 'tt4169250', title: 'M.S. Dhoni: The Untold Story', year: 2016, rating: 8, runtime: '3h 4m', genres: ["Biography", "Drama", "Sport"], director: 'Neeraj Pandey', stars: ["Sushant Singh Rajput", "Kiara Advani", "Disha Patani", "Anupam Kher"], plot: 'The untold story of Mahendra Singh Dhoni\'s journey from ticket collector to trophy collector - the world-cup-winning captain of the Indian Cricket Team.' },
        { id: 'tt0120382', title: 'The Truman Show', year: 1998, rating: 8.2, runtime: '1h 43m', genres: ["Comedy", "Drama"], director: 'Peter Weir', stars: ["Jim Carrey", "Ed Harris", "Laura Linney", "Noah Emmerich"], plot: 'An insurance salesman begins to suspect that his whole life is actually some sort of reality TV show.' },
        { id: 'tt3405236', title: 'Raees', year: 2017, rating: 6.6, runtime: '2h 23m', genres: ["Action", "Crime", "Drama"], director: 'Rahul Dholakia', stars: ["Shah Rukh Khan", "Jaideep Ahlawat", "Sunny Leone", "Mahira Khan"], plot: 'A bootlegger sets out to improve his community as a promising leader but falls in a political trap.' },
        { id: 'tt1188996', title: 'My Name Is Khan', year: 2010, rating: 7.9, runtime: '2h 45m', genres: ["Drama", "Romance"], director: 'Karan Johar', stars: ["Shah Rukh Khan", "Kajol", "Sheetal Menon", "Katie Amanda Keane"], plot: 'Rizwan Khan is a Muslim immigrant to the US with Asperger\'s syndrome. After his family falls apart in the aftermath of 9/11, he begins an epic quest across the country to speak to the President of the United States and clear his name.' },
        { id: 'tt3495026', title: 'Fan', year: 2016, rating: 6.8, runtime: '2h 22m', genres: ["Action", "Drama", "Thriller"], director: 'Maneesh Sharma', stars: ["Shah Rukh Khan", "Shriya Pilgaonkar", "Sayani Gupta", "Waluscha De Sousa"], plot: 'A man named Gaurav is obsessed with Bollywood superstar Aryan Khanna, who he bears a striking resemblance to. However, when his hero rejects him, he decides to seek revenge.' },
        { id: 'tt1182937', title: 'Rab Ne Bana Di Jodi', year: 2008, rating: 7.2, runtime: '2h 47m', genres: ["Comedy", "Drama", "Music"], director: 'Aditya Chopra', stars: ["Shah Rukh Khan", "Anushka Sharma", "Vinay Pathak", "M.K. Raina"], plot: 'A boring, reserved husband secretly becomes a lively, confident stranger to woo his own unaware wife only to make her fall head over heels for his dashing alter ego.' },
        { id: 'tt4535650', title: 'Dilwale', year: 2015, rating: 5.1, runtime: '2h 38m', genres: ["Action", "Comedy", "Drama"], director: 'Rohit Shetty', stars: ["Shah Rukh Khan", "Kajol", "Varun Dhawan", "Kriti Sanon"], plot: 'The younger siblings of two estranged lovers fall for each other, unaware of the violent past that drove the elder ones apart.' },
        { id: 'tt1562871', title: 'Ra.One', year: 2011, rating: 5, runtime: '2h 36m', genres: ["Action", "Sci-Fi", "Thriller"], director: 'Anubhav Sinha', stars: ["Shah Rukh Khan", "Kareena Kapoor", "Arjun Rampal", "Armaan Verma"], plot: 'When a gaming AI villain named Ra.One breaks into the real world, a timid boy teams up with his late father\'s heroic digital avatar to battle an unstoppable digital god bent on total destruction.' },
        { id: 'tt0461936', title: 'Don', year: 2006, rating: 7.2, runtime: '2h 51m', genres: ["Action", "Crime", "Thriller"], director: 'Farhan Akhtar', stars: ["Shah Rukh Khan", "Priyanka Chopra Jonas", "Arjun Rampal", "Isha Koppikar"], plot: 'Vijay is recruited by a police officer to masquerade as his lookalike Don, the leader of an international gang of smugglers. Things go wrong when the officer is killed and Vijay is left to fend for himself.' },
        { id: 'tt1024943', title: 'Om Shanti Om', year: 2007, rating: 6.9, runtime: '2h 42m', genres: ["Action", "Comedy", "Drama"], director: 'Farah Khan', stars: ["Shah Rukh Khan", "Deepika Padukone", "Arjun Rampal", "Kirron Kher"], plot: 'A struggling junior artist dies trying to save his dream girl, only to be reborn as a superstar. 30 years later, he returns with style, stardom, and revenge to expose the killer.' },
        { id: 'tt0367110', title: 'Swades', year: 2004, rating: 8.2, runtime: '3h 9m', genres: ["Drama", "Musical"], director: 'Ashutosh Gowariker', stars: ["Shah Rukh Khan", "Gayatri Joshi", "Kishori Ballal", "Smith Seth"], plot: 'A successful Indian scientist returns to an Indian village to take his nanny to America with him and in the process rediscovers his roots.' },
        { id: 'tt0347473', title: 'Main Hoon Na', year: 2004, rating: 7.1, runtime: '3h 2m', genres: ["Action", "Comedy", "Drama"], director: 'Farah Khan', stars: ["Shah Rukh Khan", "Sushmita Sen", "Suniel Shetty", "Zayed Khan"], plot: 'An army major goes undercover as a college student. His mission is both professional and personal: to protect his general\'s daughter from a radical militant, and to find his estranged half-brother.' },
        { id: 'tt0213890', title: 'Mohabbatein', year: 2000, rating: 7.1, runtime: '3h 36m', genres: ["Drama", "Musical", "Romance"], director: 'Aditya Chopra', stars: ["Amitabh Bachchan", "Shah Rukh Khan", "Aishwarya Rai Bachchan", "Jimmy Shergill"], plot: 'A film about the battle between love and fear, between two stubborn men and their opposing beliefs and the outcome of the love stories of 3 couples.' },
        { id: 'tt4832640', title: 'Sultan', year: 2016, rating: 7.1, runtime: '2h 50m', genres: ["Action", "Drama", "Romance"], director: 'Ali Abbas Zafar', stars: ["Salman Khan", "Anushka Sharma", "Randeep Hooda", "Amit Sadh"], plot: 'A small-town wrestler chases Olympic glory, falls for a fierce female champion, builds a life around her dreams as much as his own, then watches it collapse; years later, he fights his way back from ruin.' },
        { id: 'tt3863552', title: 'Bajrangi Bhaijaan', year: 2015, rating: 8.1, runtime: '2h 43m', genres: ["Adventure", "Comedy", "Drama"], director: 'Kabir Khan', stars: ["Salman Khan", "Harshaali Malhotra", "Nawazuddin Siddiqui", "Kareena Kapoor"], plot: 'An Indian man with a magnanimous heart takes a young mute Pakistani girl back to her homeland to reunite her with her family.' },
        { id: 'tt2372222', title: 'Kick', year: 2014, rating: 5.9, runtime: '2h 26m', genres: ["Action", "Comedy", "Crime"], director: '', stars: ["Salman Khan", "Jacqueline Fernandez", "Nawazuddin Siddiqui", "Randeep Hooda"], plot: 'An adrenaline junkie walks away from a whirlwind romance and embraces a new life as a thief, though he soon finds himself pursued by veteran police officer and engaged in a turf war with a local gangster.' },
        { id: 'tt1620719', title: 'Dabangg', year: 2010, rating: 6.3, runtime: '2h 6m', genres: ["Action", "Comedy", "Crime"], director: 'Abhinav Kashyap', stars: ["Salman Khan", "Sonakshi Sinha", "Sonu Sood", "Arbaaz Khan"], plot: 'A corrupt police officer faces challenges from his family, gangsters and politicians.' },
        { id: 'tt0807758', title: 'Partner', year: 2007, rating: 5.9, runtime: '2h 35m', genres: ["Comedy", "Drama", "Romance"], director: 'David Dhawan', stars: ["Salman Khan", "Govinda", "Lara Dutta", "Katrina Kaif"], plot: 'Prem, a love guru who shares tips on dating women, helps his client, Bhaskar, woo his boss. However, he later falls for a single mother and tries to hide his profession.' },
        { id: 'tt0374271', title: 'In Your Name', year: 2003, rating: 7.2, runtime: '2h 12m', genres: ["Action", "Drama", "Romance"], director: 'Satish Kaushik', stars: ["Salman Khan", "Bhoomika Chawla", "Sachin Khedekar", "Savita Prabhune"], plot: 'A graduate jobless rowdy falls deeply in love with a simple, innocent girl. after their fiery clashes turn into fierce attraction. Just as she reciprocates his love, a savage attack leaves him mentally shattered.' },
        { id: 'tt12844910', title: 'Pathaan', year: 2023, rating: 5.8, runtime: '2h 26m', genres: ["Action", "Adventure", "Thriller"], director: 'Siddharth Anand', stars: ["Shah Rukh Khan", "Deepika Padukone", "John Abraham", "Dimple Kapadia"], plot: 'An Indian agent races against a doomsday clock as a ruthless mercenary, with a bitter vendetta, mounts an apocalyptic attack against the country.' },
        { id: 'tt0787524', title: 'The Man Who Knew Infinity', year: 2015, rating: 7.2, runtime: '1h 48m', genres: ["Biography", "Drama"], director: 'Matt Brown', stars: ["Dev Patel", "Jeremy Irons", "Malcolm Sinclair", "Raghuvir Joshi"], plot: 'The story of the life and academic career of the pioneer Indian mathematician, Srinivasa Ramanujan, and his friendship with his mentor, Professor G.H. Hardy.' },
        { id: 'tt1469304', title: 'Baywatch', year: 2017, rating: 5.5, runtime: '1h 56m', genres: ["Action", "Comedy", "Crime"], director: 'Seth Gordon', stars: ["Dwayne Johnson", "Zac Efron", "Alexandra Daddario", "Priyanka Chopra Jonas"], plot: 'Devoted lifeguard Mitch Buchannon butts heads with a brash new recruit, as they uncover a criminal plot that threatens the future of the bay.' },
        { id: 'tt1390411', title: 'In the Heart of the Sea', year: 2015, rating: 6.9, runtime: '2h 2m', genres: ["Action", "Adventure", "Biography"], director: 'Ron Howard', stars: ["Chris Hemsworth", "Cillian Murphy", "Brendan Gleeson", "Benjamin Walker"], plot: 'A recounting of a New England whaling ship\'s sinking by a giant whale in 1820, an experience that later inspired the great novel Moby-Dick.' },
        { id: 'tt5700672', title: 'Train to Busan', year: 2016, rating: 7.6, runtime: '1h 58m', genres: ["Action", "Horror", "Thriller"], director: 'Yeon Sang-ho', stars: ["Gong Yoo", "Jung Yu-mi", "Ma Dong-seok", "Kim Su-an"], plot: 'While a zombie virus breaks out in South Korea, passengers struggle to survive on the train from Seoul to Busan.' },
        { id: 'tt0144084', title: 'American Psycho', year: 2000, rating: 7.6, runtime: '1h 42m', genres: ["Crime", "Drama", "Horror"], director: 'Mary Harron', stars: ["Christian Bale", "Justin Theroux", "Josh Lucas", "Bill Sage"], plot: 'A wealthy New York City investment banking executive, Patrick Bateman, hides his alternate psychopathic ego from his co-workers and friends as he delves deeper into his violent, hedonistic fantasies.' },
        { id: 'tt0259324', title: 'Ghost Rider', year: 2007, rating: 5.3, runtime: '1h 50m', genres: ["Action", "Fantasy", "Thriller"], director: 'Mark Steven Johnson', stars: ["Nicolas Cage", "Eva Mendes", "Sam Elliott", "Matt Long"], plot: 'A motorcycle stuntman who sold his soul becomes a supernatural agent of vengeance.' },
        { id: 'tt2322441', title: 'Fifty Shades of Grey', year: 2015, rating: 4.2, runtime: '2h 5m', genres: ["Drama", "Romance", "Thriller"], director: 'Sam Taylor-Johnson', stars: ["Dakota Johnson", "Jamie Dornan", "Jennifer Ehle", "Eloise Mumford"], plot: 'Literature student Anastasia Steele\'s life changes forever when she meets handsome, yet tormented, billionaire Christian Grey.' },
        { id: 'tt4465564', title: 'Fifty Shades Darker', year: 2017, rating: 4.6, runtime: '1h 58m', genres: ["Drama", "Mystery", "Romance"], director: 'James Foley', stars: ["Dakota Johnson", "Jamie Dornan", "Eric Johnson", "Eloise Mumford"], plot: 'While Christian wrestles with his inner demons, Anastasia must confront the anger and envy of the women who came before her.' },
        { id: 'tt4477536', title: 'Fifty Shades Freed', year: 2018, rating: 4.6, runtime: '1h 45m', genres: ["Drama", "Mystery", "Romance"], director: 'James Foley', stars: ["Dakota Johnson", "Jamie Dornan", "Eric Johnson", "Eloise Mumford"], plot: 'Anastasia and Christian get married, but Jack Hyde continues to threaten their relationship.' },
        { id: 'tt1690953', title: 'Despicable Me 2', year: 2013, rating: 7.3, runtime: '1h 38m', genres: ["Animation", "Adventure", "Comedy"], director: '', stars: ["Steve Carell", "Kristen Wiig", "Benjamin Bratt", "Miranda Cosgrove"], plot: 'When a new criminal comes to town, the Anti-Villain League decides to hire Gru in order to fight him off. While Gru initially refuses, he eventually agrees after his aide goes back to his evil ways.' },
        { id: 'tt9243946', title: 'El Camino', year: 2019, rating: 7.3, runtime: '2h 2m', genres: ["Crime", "Drama", "Thriller"], director: 'Vince Gilligan', stars: ["Aaron Paul", "Jonathan Banks", "Matt Jones", "Charles Baker"], plot: 'Fugitive Jesse Pinkman runs from his captors, the law, and his past.' },
        { id: 'tt7713068', title: 'Birds of Prey and the Fantabulous Emancipation of One Harley Quinn', year: 2020, rating: 6, runtime: '1h 49m', genres: ["Action", "Comedy", "Crime"], director: 'Cathy Yan', stars: ["Margot Robbie", "Rosie Perez", "Mary Elizabeth Winstead", "Jurnee Smollett"], plot: 'After splitting with the Joker, Harley Quinn joins superheroines Black Canary, Huntress, and Renee Montoya to save a young girl from an evil crime lord.' },
        { id: 'tt1727824', title: 'Bohemian Rhapsody', year: 2018, rating: 7.9, runtime: '2h 14m', genres: ["Biography", "Drama", "Music"], director: 'Bryan Singer', stars: ["Rami Malek", "Lucy Boynton", "Gwilym Lee", "Ben Hardy"], plot: 'With his impeccable vocal abilities, Freddie Mercury and his rock band, Queen, achieve superstardom. However, amidst his skyrocketing success, he grapples with his ego, sexuality and a fatal illness.' },
        { id: 'tt0332280', title: 'The Notebook', year: 2004, rating: 7.8, runtime: '2h 3m', genres: ["Drama", "Romance"], director: 'Nick Cassavetes', stars: ["Gena Rowlands", "James Garner", "Rachel McAdams", "Ryan Gosling"], plot: 'An elderly man reads to a woman with dementia the story of two young lovers whose romance is threatened by the difference in their respective social classes.' },
        { id: 'tt2659414', title: 'Miracle in Cell No. 7', year: 2013, rating: 8.1, runtime: '2h 7m', genres: ["Comedy", "Drama"], director: 'Lee Hwan-kyung', stars: ["Ryu Seung-ryong", "Kal So-won", "Oh Dal-su", "Jeong Man-sik"], plot: 'A story about the love between a mentally-ill father and his lovingly adorable daughter.' },
        { id: 'tt5074352', title: 'Dangal', year: 2016, rating: 8.3, runtime: '2h 41m', genres: ["Action", "Biography", "Drama"], director: 'Nitesh Tiwari', stars: ["Aamir Khan", "Sakshi Tanwar", "Fatima Sana Shaikh", "Sanya Malhotra"], plot: 'Mahavir Singh Phogat, a former wrestler, decides to fulfill his dream of winning a gold medal for his country by training his daughters for the Commonwealth Games despite the existing social stigmas.' },
        { id: 'tt7218518', title: 'Pad Man', year: 2018, rating: 7.8, runtime: '2h 20m', genres: ["Comedy", "Drama"], director: 'R Balki', stars: ["Akshay Kumar", "Radhika Apte", "Sonam Kapoor", "Jyoti Subhash"], plot: 'Upon realizing the extent to which women are affected by their menses, a man sets out to create a sanitary pad machine and to provide inexpensive sanitary pads to the women of rural India.' },
        { id: 'tt6826438', title: 'Parmanu: The Story of Pokhran', year: 2018, rating: 7.6, runtime: '2h 9m', genres: ["Drama", "History", "Thriller"], director: 'Abhishek Sharma', stars: ["John Abraham", "Boman Irani", "Diana Penty", "Anuja Sathe"], plot: 'Ashwat Raina and his teammates arrive in Pokhran to re-conduct a confidential nuclear test, where they face challenges from the American Lacrosse satellite and local spies.' },
        { id: 'tt0320661', title: 'Kingdom of Heaven', year: 2005, rating: 7.3, runtime: '2h 24m', genres: ["Action", "Adventure", "Drama"], director: 'Ridley Scott', stars: ["Orlando Bloom", "Eva Green", "Liam Neeson", "Martin Hancock"], plot: 'Balian of Ibelin travels to Jerusalem during the Crusades of the 12th century, and there he finds himself as the defender of the city and its people.' },
        { id: 'tt11378946', title: 'Michael', year: 2026, rating: 7.3, runtime: '2h 7m', genres: ["Biography", "Drama", "History"], director: 'Antoine Fuqua', stars: ["Jaafar Jackson", "Nia Long", "Colman Domingo", "Juliano Valdi"], plot: 'The early life of musician Michael Jackson, from the discovery of his talent as the lead of the Jackson Five to the artist whose creative ambition fueled a pursuit to become the biggest entertainer in the world.' },
    ];


    let isVwgBuilt = false;
    let rafId = null;
    let activeGenre = 'all';
    let searchQuery = '';

    const rowsConfig = [
        { baseSpeed: -0.55, currentSpeed: -0.55, targetSpeed: -0.55, x: 0, dragVelocity: 0, singleSetWidth: 0, isHovered: false, isDragging: false },
        { baseSpeed: 0.42,  currentSpeed: 0.42,  targetSpeed: 0.42,  x: 0, dragVelocity: 0, singleSetWidth: 0, isHovered: false, isDragging: false },
        { baseSpeed: -0.50, currentSpeed: -0.50, targetSpeed: -0.50, x: 0, dragVelocity: 0, singleSetWidth: 0, isHovered: false, isDragging: false }
    ];

    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function buildCardHtml(m) {
        const titleSafe = escapeHtml(m.title);
        const ratingHtml = m.rating 
            ? `<div class="vwg-rating" aria-label="Rating ${m.rating} out of 10">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="#f5c518" aria-hidden="true"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
                <span>${m.rating}</span>
               </div>`
            : '';
        const genresStr = (m.genres && m.genres.length) ? m.genres.slice(0, 1).join(', ') : '';
        const metaStr = [m.year, genresStr].filter(Boolean).join(' • ');

        return `
            <div class="vwg-card" data-id="${m.id}" role="button" tabindex="0" aria-label="${titleSafe}">
                <div class="vwg-media">
                    <img class="vwg-poster" src="assets/img/movies/${m.id}.webp" alt="${titleSafe}" loading="lazy" width="184" height="275" draggable="false">
                </div>
                <div class="vwg-glyph" aria-hidden="true">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7" />
                    </svg>
                </div>
                ${ratingHtml}
                <div class="vwg-card-info">
                    <div class="vwg-card-title">${titleSafe}</div>
                    <div class="vwg-card-meta">${metaStr}</div>
                </div>
            </div>
        `;
    }

    function initVideoWallGallery() {
        const wrap = document.getElementById('vwgWrapper');
        if (!wrap) return;

        const rowEls = [
            document.getElementById('vwgRow0'),
            document.getElementById('vwgRow1'),
            document.getElementById('vwgRow2')
        ];
        const trackEls = [
            document.getElementById('vwgTrack0'),
            document.getElementById('vwgTrack1'),
            document.getElementById('vwgTrack2')
        ];

        if (!trackEls[0] || !trackEls[1] || !trackEls[2]) return;

        if (!isVwgBuilt) {
            isVwgBuilt = true;

            // Partition movies into 3 rows
            const partitioned = [[], [], []];
            moviesData.forEach((m, idx) => {
                partitioned[idx % 3].push(m);
            });

            // Build rows (double elements for seamless infinite marquee loop)
            partitioned.forEach((rowList, rIdx) => {
                const singleHtml = rowList.map(buildCardHtml).join('');
                trackEls[rIdx].innerHTML = singleHtml + singleHtml;
            });

            setupInteractions(rowEls, trackEls);
            setupFilterAndSearch();
            setupModal();
        }

        // Recalculate dimensions
        measureRows(trackEls);

        // Start animation loop if not already running
        if (!rafId) {
            rafId = requestAnimationFrame(animateLoop);
        }
    }

    function measureRows(trackEls) {
        trackEls.forEach((track, rIdx) => {
            if (!track) return;
            const fullW = track.scrollWidth;
            rowsConfig[rIdx].singleSetWidth = fullW / 2;
            // Stagger starting offsets
            if (rowsConfig[rIdx].x === 0) {
                if (rIdx === 1) {
                    rowsConfig[rIdx].x = -rowsConfig[rIdx].singleSetWidth / 2;
                } else if (rIdx === 2) {
                    rowsConfig[rIdx].x = -rowsConfig[rIdx].singleSetWidth / 4;
                }
            }
        });
    }

    function animateLoop() {
        const moviesContent = document.getElementById('movies-content');
        const isVisible = moviesContent && (moviesContent.style.display !== 'none') && moviesContent.classList.contains('active');

        if (isVisible) {
            const trackEls = [
                document.getElementById('vwgTrack0'),
                document.getElementById('vwgTrack1'),
                document.getElementById('vwgTrack2')
            ];

            rowsConfig.forEach((cfg, rIdx) => {
                const track = trackEls[rIdx];
                if (!track || !cfg.singleSetWidth) return;

                // Smooth speed lerp
                cfg.currentSpeed += (cfg.targetSpeed - cfg.currentSpeed) * 0.08;

                if (!cfg.isDragging) {
                    cfg.x += cfg.currentSpeed + cfg.dragVelocity;
                    cfg.dragVelocity *= 0.94; // Momentum decay
                }

                // Seamless loop wrap
                const half = cfg.singleSetWidth;
                if (cfg.x <= -half) {
                    cfg.x += half;
                } else if (cfg.x >= 0) {
                    cfg.x -= half;
                }

                track.style.transform = `translate3d(${cfg.x.toFixed(2)}px, 0, 0)`;
            });
        }

        rafId = requestAnimationFrame(animateLoop);
    }

    function setupInteractions(rowEls, trackEls) {
        rowEls.forEach((row, rIdx) => {
            if (!row) return;
            const cfg = rowsConfig[rIdx];

            // Hover pause/slowdown
            row.addEventListener('mouseenter', () => {
                cfg.isHovered = true;
                cfg.targetSpeed = 0;
            });

            row.addEventListener('mouseleave', () => {
                cfg.isHovered = false;
                cfg.targetSpeed = cfg.baseSpeed;
                if (cfg.isDragging) {
                    cfg.isDragging = false;
                    row.classList.remove('is-dragging');
                }
            });

            // Pointer drag with momentum
            let startX = 0;
            let prevX = 0;
            let hasMoved = false;

            row.addEventListener('pointerdown', (e) => {
                if (e.target.closest('button, a')) return;
                cfg.isDragging = true;
                hasMoved = false;
                startX = e.clientX;
                prevX = e.clientX;
                cfg.dragVelocity = 0;
                row.classList.add('is-dragging');
                try { row.setPointerCapture(e.pointerId); } catch (_) {}
            });

            row.addEventListener('pointermove', (e) => {
                if (!cfg.isDragging) return;
                const deltaX = e.clientX - prevX;
                cfg.x += deltaX;
                cfg.dragVelocity = deltaX * 0.8;
                prevX = e.clientX;
                if (Math.abs(e.clientX - startX) > 6) {
                    hasMoved = true;
                }
            });

            const endDrag = (e) => {
                if (!cfg.isDragging) return;
                cfg.isDragging = false;
                row.classList.remove('is-dragging');
                try { row.releasePointerCapture(e.pointerId); } catch (_) {}
                // Resume target speed if not hovering
                if (!cfg.isHovered) {
                    cfg.targetSpeed = cfg.baseSpeed;
                }
            };

            row.addEventListener('pointerup', endDrag);
            row.addEventListener('pointercancel', endDrag);

            // Card click listener with drag threshold protection
            row.addEventListener('click', (e) => {
                if (hasMoved) return;
                const card = e.target.closest('.vwg-card');
                if (card && card.dataset.id) {
                    openMovieModal(card.dataset.id);
                }
            });

            // Keyboard accessibility for cards
            row.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    const card = e.target.closest('.vwg-card');
                    if (card && card.dataset.id) {
                        e.preventDefault();
                        openMovieModal(card.dataset.id);
                    }
                }
            });
        });

        window.addEventListener('resize', () => {
            measureRows(trackEls);
        });
    }

    function setupFilterAndSearch() {
        const genresBar = document.getElementById('vwgGenresBar');
        const searchInput = document.getElementById('vwgSearchInput');
        const searchClear = document.getElementById('vwgSearchClear');

        if (genresBar) {
            genresBar.addEventListener('click', (e) => {
                const btn = e.target.closest('.vwg-genre-pill');
                if (!btn) return;

                genresBar.querySelectorAll('.vwg-genre-pill').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                activeGenre = btn.getAttribute('data-genre') || 'all';
                applyFilterAndSearch();
            });
        }

        if (searchInput) {
            searchInput.addEventListener('input', () => {
                searchQuery = (searchInput.value || '').trim().toLowerCase();
                if (searchClear) {
                    searchClear.style.display = searchQuery ? 'flex' : 'none';
                }
                applyFilterAndSearch();
            });
        }

        if (searchClear && searchInput) {
            searchClear.addEventListener('click', () => {
                searchInput.value = '';
                searchQuery = '';
                searchClear.style.display = 'none';
                searchInput.focus();
                applyFilterAndSearch();
            });
        }
    }

    function applyFilterAndSearch() {
        const allCards = document.querySelectorAll('.vwg-card');
        const moviesMap = new Map();
        moviesData.forEach(m => moviesMap.set(m.id, m));

        allCards.forEach(card => {
            const mid = card.getAttribute('data-id');
            const m = moviesMap.get(mid);
            if (!m) return;

            // Genre check
            const matchesGenre = (activeGenre === 'all') || (m.genres && m.genres.some(g => g.toLowerCase() === activeGenre.toLowerCase()));

            // Search check
            let matchesSearch = true;
            if (searchQuery) {
                const inTitle = m.title.toLowerCase().includes(searchQuery);
                const inDirector = m.director && m.director.toLowerCase().includes(searchQuery);
                const inStars = m.stars && m.stars.some(s => s.toLowerCase().includes(searchQuery));
                const inYear = m.year && String(m.year).includes(searchQuery);
                matchesSearch = inTitle || inDirector || inStars || inYear;
            }

            const isMatch = matchesGenre && matchesSearch;

            if (isMatch) {
                card.classList.remove('dimmed');
                if (searchQuery) {
                    card.classList.add('highlighted');
                } else {
                    card.classList.remove('highlighted');
                }
            } else {
                card.classList.add('dimmed');
                card.classList.remove('highlighted');
            }
        });
    }

    function openMovieModal(mid) {
        const m = moviesData.find(item => item.id === mid);
        if (!m) return;

        const modal = document.getElementById('vwgModal');
        const poster = document.getElementById('vwgModalPoster');
        const title = document.getElementById('vwgModalTitle');
        const rating = document.getElementById('vwgModalRating');
        const year = document.getElementById('vwgModalYear');
        const runtime = document.getElementById('vwgModalRuntime');
        const genresWrap = document.getElementById('vwgModalGenres');
        const plot = document.getElementById('vwgModalPlot');
        const dir = document.getElementById('vwgModalDirector');
        const dirWrap = document.getElementById('vwgCreditDirectorWrap');
        const stars = document.getElementById('vwgModalStars');
        const starsWrap = document.getElementById('vwgCreditStarsWrap');
        const imdbLink = document.getElementById('vwgModalImdbLink');

        if (!modal) return;

        if (poster) {
            poster.src = `assets/img/movies/${m.id}.webp`;
            poster.alt = m.title;
        }
        if (title) title.textContent = m.title;
        if (year) {
            year.textContent = m.year || '';
            year.style.display = m.year ? 'inline-block' : 'none';
        }
        if (runtime) {
            runtime.textContent = m.runtime || '';
            runtime.style.display = m.runtime ? 'inline-block' : 'none';
        }
        if (rating) {
            if (m.rating) {
                rating.innerHTML = `<i class="fas fa-star" aria-hidden="true"></i> <span>${m.rating} / 10</span>`;
                rating.style.display = 'inline-flex';
            } else {
                rating.style.display = 'none';
            }
        }
        if (genresWrap) {
            genresWrap.innerHTML = (m.genres || []).map(g => `<span class="vwg-modal-genre-tag">${escapeHtml(g)}</span>`).join('');
        }
        if (plot) {
            plot.textContent = m.plot || 'A featured title in Robin Hossain\'s movie watchlist.';
        }
        if (dir && dirWrap) {
            if (m.director) {
                dir.textContent = m.director;
                dirWrap.style.display = 'block';
            } else {
                dirWrap.style.display = 'none';
            }
        }
        if (stars && starsWrap) {
            if (m.stars && m.stars.length) {
                stars.textContent = m.stars.join(', ');
                starsWrap.style.display = 'block';
            } else {
                starsWrap.style.display = 'none';
            }
        }
        if (imdbLink) {
            imdbLink.href = `https://www.imdb.com/title/${m.id}/`;
        }

        modal.classList.add('is-open');
        modal.setAttribute('aria-hidden', 'false');
        document.body.style.overflow = 'hidden';
    }

    function closeMovieModal() {
        const modal = document.getElementById('vwgModal');
        if (!modal) return;
        modal.classList.remove('is-open');
        modal.setAttribute('aria-hidden', 'true');
        document.body.style.overflow = '';
    }

    function setupModal() {
        const modal = document.getElementById('vwgModal');
        const closeBtn = document.getElementById('vwgModalClose');
        if (!modal) return;

        if (closeBtn) {
            closeBtn.addEventListener('click', closeMovieModal);
        }

        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                closeMovieModal();
            }
        });

        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && modal.classList.contains('is-open')) {
                closeMovieModal();
            }
        });
    }

    // Export globally for tab invocation
    window.initVideoWallGallery = initVideoWallGallery;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            // Pre-measure if already visible
            const moviesContent = document.getElementById('movies-content');
            if (moviesContent && moviesContent.classList.contains('active')) {
                initVideoWallGallery();
            }
        });
    } else {
        const moviesContent = document.getElementById('movies-content');
        if (moviesContent && moviesContent.classList.contains('active')) {
            initVideoWallGallery();
        }
    }
})();
