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
    const isMobile = window.innerWidth <= 768;
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
    // Quote Rotator & Componentry Signature Engine for Favorite Quote section
    // Style source: pnpm dlx shadcn@latest add @componentry/signature
    // Componentry Reference: https://componentry.dev/docs/components/signature
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
    const authorSigContainer = document.getElementById('quoteAuthorSignature') || document.querySelector('.author-signature');
    let quoteIndex = 0;

    let signatureFont = null;
    let signatureFontLoading = null;
    const signaturePathCache = new Map();

    function loadSignatureFont() {
        if (signatureFont) return Promise.resolve(signatureFont);
        if (signatureFontLoading) return signatureFontLoading;

        signatureFontLoading = new Promise((resolve) => {
            if (typeof opentype === 'undefined') {
                console.warn('opentype.js not loaded, using text fallback');
                resolve(null);
                return;
            }
            const fontPaths = [
                'assets/fonts/LastoriaBoldRegular.otf',
                '/assets/fonts/LastoriaBoldRegular.otf',
                './assets/fonts/LastoriaBoldRegular.otf',
                'https://componentry.dev/LastoriaBoldRegular.otf',
                'https://www.componentry.fun/LastoriaBoldRegular.otf'
            ];

            function tryNextPath(idx) {
                if (idx >= fontPaths.length) {
                    console.warn('Signature font could not be loaded from any path');
                    resolve(null);
                    return;
                }
                opentype.load(fontPaths[idx], (err, font) => {
                    if (err || !font) {
                        tryNextPath(idx + 1);
                    } else {
                        signatureFont = font;
                        resolve(font);
                    }
                });
            }
            tryNextPath(0);
        });
        return signatureFontLoading;
    }

    function renderSignatureComponent(container, options = {}) {
        if (!container) return;
        const text = options.text || 'Carl Sagan';
        const isMobile = window.innerWidth < 640;
        const fontSize = options.fontSize || (isMobile ? 24 : 29);
        const duration = options.duration || 1.35;
        const delay = options.delay !== undefined ? options.delay : 0.08;
        const color = options.color || 'currentColor';

        if (!signatureFont) {
            loadSignatureFont().then((font) => {
                if (font) renderSignatureComponent(container, options);
            });
            return;
        }

        const height = fontSize * 2.8;
        const horizontalPadding = fontSize * 0.15;
        const baseline = fontSize * 1.5;
        const maskId = `sig-reveal-${Math.random().toString(36).substr(2, 9)}`;

        let x = horizontalPadding;
        let paths = signaturePathCache.get(`${text}_${fontSize}`);

        if (!paths) {
            paths = [];
            for (const char of text) {
                const glyph = signatureFont.charToGlyph(char);
                const path = glyph.getPath(x, baseline, fontSize);
                paths.push(path.toPathData(3));
                const advanceWidth = glyph.advanceWidth ?? signatureFont.unitsPerEm;
                x += advanceWidth * (fontSize / signatureFont.unitsPerEm);
            }
            signaturePathCache.set(`${text}_${fontSize}`, paths);
        } else {
            x = horizontalPadding;
            for (const char of text) {
                const glyph = signatureFont.charToGlyph(char);
                const advanceWidth = glyph.advanceWidth ?? signatureFont.unitsPerEm;
                x += advanceWidth * (fontSize / signatureFont.unitsPerEm);
            }
        }

        const width = Math.ceil(x + horizontalPadding);

        const svgNS = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(svgNS, 'svg');
        svg.setAttribute('width', width);
        svg.setAttribute('height', height);
        svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
        svg.setAttribute('fill', 'none');
        svg.classList.add('componentry-signature-svg');

        const defs = document.createElementNS(svgNS, 'defs');
        const mask = document.createElementNS(svgNS, 'mask');
        mask.setAttribute('id', maskId);
        mask.setAttribute('maskUnits', 'userSpaceOnUse');

        const maskPaths = [];
        const strokePaths = [];

        paths.forEach((d) => {
            const mp = document.createElementNS(svgNS, 'path');
            mp.setAttribute('d', d);
            mp.setAttribute('stroke', 'white');
            mp.setAttribute('stroke-width', String(fontSize * 0.24));
            mp.setAttribute('fill', 'none');
            mp.setAttribute('stroke-linecap', 'round');
            mp.setAttribute('stroke-linejoin', 'round');
            mp.setAttribute('vector-effect', 'non-scaling-stroke');
            mask.appendChild(mp);
            maskPaths.push(mp);

            const sp = document.createElementNS(svgNS, 'path');
            sp.setAttribute('d', d);
            sp.setAttribute('stroke', color);
            sp.setAttribute('stroke-width', '1.8');
            sp.setAttribute('fill', 'none');
            sp.setAttribute('stroke-linecap', 'round');
            sp.setAttribute('stroke-linejoin', 'round');
            sp.setAttribute('vector-effect', 'non-scaling-stroke');
            strokePaths.push(sp);
        });

        defs.appendChild(mask);
        svg.appendChild(defs);

        const fillGroup = document.createElementNS(svgNS, 'g');
        fillGroup.setAttribute('mask', `url(#${maskId})`);
        paths.forEach((d) => {
            const fp = document.createElementNS(svgNS, 'path');
            fp.setAttribute('d', d);
            fp.setAttribute('fill', color);
            fillGroup.appendChild(fp);
        });

        strokePaths.forEach((sp) => svg.appendChild(sp));
        svg.appendChild(fillGroup);

        const accessibleSpan = document.createElement('span');
        accessibleSpan.className = 'author-name sr-only';
        accessibleSpan.textContent = text;

        container.innerHTML = '';
        container.appendChild(svg);
        container.appendChild(accessibleSpan);
        container.classList.add('has-svg');
        container.setAttribute('aria-label', text);

        paths.forEach((_, i) => {
            const mp = maskPaths[i];
            const sp = strokePaths[i];
            const len = mp.getTotalLength ? mp.getTotalLength() : 120;
            const charDelay = (delay + i * 0.14) * 1000;
            const charDuration = duration * 1000;

            mp.style.strokeDasharray = `${len} ${len}`;
            mp.style.strokeDashoffset = `${len}`;
            mp.animate([
                { strokeDashoffset: len, opacity: 0 },
                { strokeDashoffset: len, opacity: 1, offset: 0.02 },
                { strokeDashoffset: 0, opacity: 1 }
            ], {
                duration: charDuration,
                delay: charDelay,
                easing: 'cubic-bezier(0.42, 0, 0.58, 1)',
                fill: 'forwards'
            });

            sp.style.strokeDasharray = `${len} ${len}`;
            sp.style.strokeDashoffset = `${len}`;
            sp.animate([
                { strokeDashoffset: len, opacity: 0 },
                { strokeDashoffset: len, opacity: 1, offset: 0.02 },
                { strokeDashoffset: 0, opacity: 1 }
            ], {
                duration: charDuration,
                delay: charDelay,
                easing: 'cubic-bezier(0.42, 0, 0.58, 1)',
                fill: 'forwards'
            });
        });
    }

    function showQuote(index) {
        if (!quoteText) return;
        quoteText.style.transition = 'opacity 0.6s ease';
        quoteText.style.opacity = 0;

        if (authorSigContainer) {
            authorSigContainer.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
            authorSigContainer.style.opacity = 0;
            authorSigContainer.style.transform = 'translateY(6px)';
        } else if (authorName) {
            authorName.style.transition = 'opacity 0.6s ease';
            authorName.style.opacity = 0;
        }

        setTimeout(() => {
            quoteText.textContent = '"' + quotes[index].text + '"';

            if (authorSigContainer) {
                renderSignatureComponent(authorSigContainer, { text: quotes[index].author });
                authorSigContainer.style.opacity = 1;
                authorSigContainer.style.transform = 'translateY(0)';
            } else if (authorName) {
                authorName.textContent = quotes[index].author;
                authorName.style.opacity = 1;
            }

            if (index === 0) {
                quoteText.classList.add('quote--sagan');
            } else {
                quoteText.classList.remove('quote--sagan');
            }
            quoteText.style.opacity = 1;
        }, 600);
    }

    if (authorSigContainer) {
        authorSigContainer.addEventListener('click', () => {
            renderSignatureComponent(authorSigContainer, { text: quotes[quoteIndex].author });
        });
    }

    const quoteSection = document.getElementById('quote');
    if (quoteSection && 'IntersectionObserver' in window) {
        let signatureTriggered = false;
        const sigObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting && !signatureTriggered) {
                    signatureTriggered = true;
                    if (authorSigContainer) {
                        renderSignatureComponent(authorSigContainer, { text: quotes[quoteIndex].author });
                    }
                }
            });
        }, { threshold: 0.2 });
        sigObserver.observe(quoteSection);
    }

    setInterval(() => {
        quoteIndex = (quoteIndex + 1) % quotes.length;
        showQuote(quoteIndex);
    }, 10000);

    loadSignatureFont().then(() => {
        if (authorSigContainer) {
            renderSignatureComponent(authorSigContainer, { text: quotes[0].author });
        }
    });
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

// Framer Pill ScrollBar (https://framer.com/m/Pill-ScrollBar-5wR5Aj.js@1V70UhCDhcNjEJTugyso)
function initPillScrollBar() {
    const track = document.getElementById('pillScrollBar');
    const progress = document.getElementById('pillScrollProgress');
    if (!track || !progress) return;

    let ticking = false;
    let isDragging = false;

    function updateProgress() {
        const docElem = document.documentElement;
        const maxScroll = Math.max(
            (docElem.scrollHeight || 0) - window.innerHeight,
            (document.body.scrollHeight || 0) - window.innerHeight,
            1
        );
        const currentScroll = window.pageYOffset || docElem.scrollTop || 0;
        const scrollFraction = Math.min(Math.max(currentScroll / maxScroll, 0), 1);
        progress.style.transform = `scaleY(${scrollFraction})`;
        track.setAttribute('aria-valuenow', Math.round(scrollFraction * 100));
        ticking = false;
    }

    function onScroll() {
        if (!ticking) {
            requestAnimationFrame(updateProgress);
            ticking = true;
        }
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    updateProgress();

    // Click & Drag interaction along the pill track to scrub scroll position
    function scrollToPosition(clientY, smooth) {
        const rect = track.getBoundingClientRect();
        if (rect.height <= 0) return;
        const offsetY = Math.min(Math.max(clientY - rect.top, 0), rect.height);
        const fraction = offsetY / rect.height;
        const docElem = document.documentElement;
        const maxScroll = Math.max(
            (docElem.scrollHeight || 0) - window.innerHeight,
            (document.body.scrollHeight || 0) - window.innerHeight,
            1
        );
        window.scrollTo({
            top: fraction * maxScroll,
            behavior: smooth ? 'smooth' : 'auto'
        });
    }

    track.addEventListener('pointerdown', (e) => {
        isDragging = true;
        track.classList.add('is-dragging');
        if (track.setPointerCapture) {
            try { track.setPointerCapture(e.pointerId); } catch (_) {}
        }
        scrollToPosition(e.clientY, false);
    });

    track.addEventListener('pointermove', (e) => {
        if (!isDragging) return;
        scrollToPosition(e.clientY, false);
    });

    const stopDragging = (e) => {
        if (isDragging) {
            isDragging = false;
            track.classList.remove('is-dragging');
            if (track.releasePointerCapture && e && e.pointerId) {
                try { track.releasePointerCapture(e.pointerId); } catch (_) {}
            }
        }
    };

    track.addEventListener('pointerup', stopDragging);
    track.addEventListener('pointercancel', stopDragging);
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


    /* ==========================================================================
       DRIFT TIMELINE CONTROLLER (https://drift-timeline.framer.website/)
       ========================================================================== */
    function initDriftTimeline() {
        const wrap = document.getElementById('driftTimelineWrap');
        const viewport = document.getElementById('driftTimelineViewport');
        const track = document.getElementById('driftTimelineTrack');
        const prevBtn = document.getElementById('driftPrevBtn');
        const nextBtn = document.getElementById('driftNextBtn');
        if (!wrap || !viewport || !track) return;

        const slides = Array.from(track.querySelectorAll('.drift-timeline-slide'));
        if (slides.length === 0) return;

        let currentIndex = 0;
        let isDragging = false;
        let startX = 0;
        let currentTranslate = 0;
        let prevTranslate = 0;
        let dragDistance = 0;
        let dragStartTime = 0;

        function calculateTargetTranslate(index) {
            const slide = slides[index];
            if (!slide) return 0;
            const viewportWidth = viewport.clientWidth;
            const slideLeft = slide.offsetLeft;
            const slideWidth = slide.offsetWidth;
            return (viewportWidth / 2) - (slideLeft + slideWidth / 2);
        }

        function updateSlide(index, smooth = true) {
            currentIndex = Math.max(0, Math.min(index, slides.length - 1));
            slides.forEach((s, i) => {
                const isActive = (i === currentIndex);
                s.classList.toggle('active', isActive);
                s.setAttribute('aria-current', isActive ? 'true' : 'false');
            });

            if (prevBtn) prevBtn.disabled = (currentIndex === 0);
            if (nextBtn) nextBtn.disabled = (currentIndex === slides.length - 1);

            const target = calculateTargetTranslate(currentIndex);
            currentTranslate = target;
            prevTranslate = target;

            track.style.transition = smooth ? 'transform 0.55s cubic-bezier(0.16, 1, 0.3, 1)' : 'none';
            track.style.transform = `translate3d(${target.toFixed(2)}px, 0, 0)`;
        }

        // Button clicks
        if (prevBtn) {
            prevBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (currentIndex > 0) updateSlide(currentIndex - 1);
            });
        }

        if (nextBtn) {
            nextBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (currentIndex < slides.length - 1) updateSlide(currentIndex + 1);
            });
        }

        // Slide click selection
        slides.forEach((slide, i) => {
            slide.addEventListener('click', (e) => {
                if (Math.abs(dragDistance) > 10) return;
                if (e.target.closest('a')) return;
                if (i !== currentIndex) {
                    updateSlide(i);
                }
            });
        });

        // Touch and pointer drag
        viewport.addEventListener('pointerdown', (e) => {
            if (e.target.closest('button') || e.target.closest('a')) return;
            isDragging = true;
            startX = e.clientX;
            dragDistance = 0;
            dragStartTime = Date.now();
            viewport.classList.add('is-dragging');
            track.style.transition = 'none';
        });

        window.addEventListener('pointermove', (e) => {
            if (!isDragging) return;
            const dx = e.clientX - startX;
            dragDistance = dx;
            const newTranslate = prevTranslate + dx;
            track.style.transform = `translate3d(${newTranslate.toFixed(2)}px, 0, 0)`;
        });

        const onPointerUp = () => {
            if (!isDragging) return;
            isDragging = false;
            viewport.classList.remove('is-dragging');
            const dragDuration = Date.now() - dragStartTime;
            const isQuickFlick = dragDuration < 300 && Math.abs(dragDistance) > 25;

            if ((dragDistance < -50 || (isQuickFlick && dragDistance < 0)) && currentIndex < slides.length - 1) {
                updateSlide(currentIndex + 1);
            } else if ((dragDistance > 50 || (isQuickFlick && dragDistance > 0)) && currentIndex > 0) {
                updateSlide(currentIndex - 1);
            } else {
                updateSlide(currentIndex);
            }
        };

        window.addEventListener('pointerup', onPointerUp);
        window.addEventListener('pointercancel', onPointerUp);

        // Keyboard navigation when focused
        viewport.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowLeft' && currentIndex > 0) {
                e.preventDefault();
                updateSlide(currentIndex - 1);
            } else if (e.key === 'ArrowRight' && currentIndex < slides.length - 1) {
                e.preventDefault();
                updateSlide(currentIndex + 1);
            }
        });

        // Responsive resize
        window.addEventListener('resize', () => {
            updateSlide(currentIndex, false);
        }, { passive: true });

        // Initial centering
        setTimeout(() => {
            updateSlide(0, false);
        }, 100);
    }

    document.addEventListener('DOMContentLoaded', initDriftTimeline);
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        setTimeout(initDriftTimeline, 50);
    }

    /* ==========================================================================
       CERTIFICATIONS TESTIMONIAL HAZE CONTROLLER (https://testimonialhaze.framer.website/)
       ========================================================================== */
    function initCertificationsHaze() {
        const wrap = document.getElementById('certHazeWrap');
        if (!wrap || wrap.dataset.initialized) return;
        wrap.dataset.initialized = 'true';

        const cards = Array.from(wrap.querySelectorAll('.cert-haze-card'));
        const dashes = Array.from(wrap.querySelectorAll('.cert-haze-dash'));
        const prevBtn = document.getElementById('certHazePrev');
        const nextBtn = document.getElementById('certHazeNext');
        const meshBg = document.getElementById('certHazeMesh');
        const stage = document.getElementById('certHazeStage');
        const total = cards.length;

        if (total === 0) return;

        let currentIndex = 0;
        let isAnimating = false;

        function setSlide(newIndex) {
            if (isAnimating) return;
            currentIndex = ((newIndex % total) + total) % total;

            cards.forEach((card, i) => {
                let diff = i - currentIndex;
                if (diff > total / 2) diff -= total;
                if (diff < -total / 2) diff += total;

                if (diff === 0) {
                    card.setAttribute('data-state', 'active');
                } else if (diff === 1) {
                    card.setAttribute('data-state', 'peek-right');
                } else if (diff === -1) {
                    card.setAttribute('data-state', 'peek-left');
                } else {
                    card.setAttribute('data-state', 'hidden');
                }
            });

            // Update dashes
            dashes.forEach((dash, i) => {
                dash.classList.toggle('active', i === currentIndex);
            });

            // Update background haze backdrop image
            const activeImg = cards[currentIndex].querySelector('.cert-haze-img-wrap img');
            if (meshBg && activeImg) {
                meshBg.style.opacity = '0.15';
                setTimeout(() => {
                    meshBg.style.backgroundImage = `url('${activeImg.src}')`;
                    meshBg.style.opacity = '0.45';
                }, 250);
            }
        }

        // Navigation controls
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

        // Clicking peek cards jumps to them
        cards.forEach((card, i) => {
            card.addEventListener('click', (e) => {
                if (e.target.closest('a') || e.target.closest('button')) return;
                const state = card.getAttribute('data-state');
                if (state === 'peek-left' || state === 'peek-right') {
                    setSlide(i);
                }
            });
        });

        // Clicking dash jumps to slide
        dashes.forEach((dash, i) => {
            dash.addEventListener('click', () => {
                setSlide(i);
            });
        });

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
            touchStartX = e.touches[0].clientX;
        }, { passive: true });

        wrap.addEventListener('touchend', (e) => {
            const touchEndX = e.changedTouches[0].clientX;
            const diff = touchEndX - touchStartX;
            if (Math.abs(diff) > 40) {
                if (diff < 0) {
                    setSlide(currentIndex + 1);
                } else {
                    setSlide(currentIndex - 1);
                }
            }
        }, { passive: true });

        // Initial state
        setSlide(0);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initCertificationsHaze);
    } else {
        initCertificationsHaze();
    }


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
            if (selectedTab === 'certifications' && typeof initCertificationsHaze === 'function') {
                initCertificationsHaze();
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
    initProfileImageFlip();
});

// Accordion functionality — Framer FAQ Accordion style
document.addEventListener('DOMContentLoaded', function() {
    const accordionItems = document.querySelectorAll('.accordion-item');

    accordionItems.forEach(item => {
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
            accordionItems.forEach(otherItem => {
                const otherHeader = otherItem.querySelector('.accordion-header');
                const otherContent = otherItem.querySelector('.accordion-content');
                otherItem.classList.remove('active');
                if (otherHeader) otherHeader.setAttribute('aria-expanded', 'false');
                if (otherContent) otherContent.style.height = '0px';
            });

            // Open clicked item if it was closed
            if (!isActive) {
                item.classList.add('active');
                header.setAttribute('aria-expanded', 'true');
                content.style.height = content.scrollHeight + 'px';
            }
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
        const TRANSITION_DURATION = 650; // ms for crossfade
        let storyProgress = 0;
        const STORY_DURATION = 5000;
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
(function() {
    function initShaderButton() {
        const btn = document.querySelector('.btn-cv-download');
        if (!btn) return;
        const canvas = btn.querySelector('.btn-shader-canvas');
        if (!canvas) return;

        const gl = canvas.getContext('webgl2', { alpha: true, antialias: false, powerPreference: 'low-power' });
        if (!gl) return;

        const vsSource = `#version 300 es
            in vec2 position;
            out vec2 v_uv;
            void main() {
                v_uv = (position + 1.0) * 0.5;
                gl_Position = vec4(position, 0.0, 1.0);
            }
        `;

        const fsSource = `#version 300 es
            precision highp float;
            in vec2 v_uv;
            out vec4 fragColor;

            uniform vec2 u_resolution;
            uniform float u_time;
            uniform float u_scale;
            uniform float u_speed;
            uniform float u_seed;
            uniform float u_turbAmp;
            uniform float u_turbFreq;
            uniform float u_turbIter;
            uniform float u_waveFreq;
            uniform float u_contrast;
            uniform float u_exposure;
            uniform float u_saturation;
            uniform float u_dither;
            uniform vec3 u_colors[4];

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
                s = hash3(s);
                return vec3(s) / float(0xFFFFFFFFu);
            }

            vec3 toLinear(vec3 c) { return pow(c, vec3(2.2)); }
            vec3 toSrgb(vec3 c) { return pow(clamp(c, 0.0, 1.0), vec3(0.4545)); }

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

            vec3 oklabToLch(vec3 lab) { return vec3(lab.x, length(lab.yz), atan(lab.z, lab.y)); }
            vec3 lchToOklab(vec3 lch) { return vec3(lch.x, lch.y * cos(lch.z), lch.y * sin(lch.z)); }

            vec3 mixLch(vec3 lab0, vec3 lab1, float t) {
                vec3 lch0 = oklabToLch(lab0);
                vec3 lch1 = oklabToLch(lab1);
                if (lch0.y < 0.05) lch0.z = lch1.z;
                if (lch1.y < 0.05) lch1.z = lch0.z;
                float dh = lch1.z - lch0.z;
                if (dh > 3.14159265) dh -= 6.28318530;
                if (dh < -3.14159265) dh += 6.28318530;
                return lchToOklab(vec3(mix(lch0.x, lch1.x, t), mix(lch0.y, lch1.y, t), lch0.z + dh * t));
            }

            vec3 palette(float t) {
                float segment = 1.0 / 3.0;
                t = clamp(t, 0.0, 1.0);
                int idx = min(int(floor(t / segment)), 2);
                float localT = (t - float(idx) * segment) / segment;
                vec3 c0 = u_colors[idx];
                vec3 c1 = u_colors[idx + 1];
                vec3 lab0 = linearToOklab(toLinear(c0));
                vec3 lab1 = linearToOklab(toLinear(c1));
                return oklabToLinear(mixLch(lab0, lab1, localT));
            }

            float quickNoise(vec2 I) {
                return fract(sin(dot(I, vec2(12.9898, 78.233))) * 43758.5453);
            }

            vec3 applyContrastSaturation(vec3 linearRgb, float contrast, float saturation) {
                vec3 lab = linearToOklab(linearRgb);
                float C = length(lab.yz) * saturation;
                float h = atan(lab.z, lab.y);
                lab.x = clamp((lab.x - 0.5) * contrast + 0.5, 0.0, 1.0);
                lab.y = C * cos(h);
                lab.z = C * sin(h);
                return oklabToLinear(lab);
            }

            void main() {
                vec2 fragCoord = v_uv * u_resolution;
                vec2 r = u_resolution;
                vec2 p = (fragCoord * 2.0 - r) / r.y;
                
                float t = u_time * 0.3;
                vec3 seedOffset = seedRandom(u_seed);
                vec3 seedOffset2 = seedRandom(u_seed + 100.0);
                
                float seedAngle = u_seed * GOLDEN_ANGLE;
                vec2 seedPhase = (seedOffset2.xy - 0.5) * TAU;
                
                float cs = cos(seedAngle);
                float sn = sin(seedAngle);
                p = mat2(cs, -sn, sn, cs) * p;
                
                float totalVal = 0.0;
                float totalWeight = 0.0;
                int turbIter = int(u_turbIter);
                float freq = 1.0 / max(u_turbFreq, 0.01);
                
                for (float i = 0.0; i < 4.0; i++) {
                    float eph = i / 4.0;
                    vec2 q = p * u_scale;
                    float a = seedPhase.x;
                    float d = seedPhase.y;
                    
                    for (int j = 2; j < 10; j++) {
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
                val = clamp((val - 0.3) / 0.4, 0.0, 1.0);
                val = clamp(val + (quickNoise(fragCoord) - 0.5) * u_dither, 0.0, 1.0);
                
                vec3 col = palette(val);
                col *= u_exposure;
                col = applyContrastSaturation(col, u_contrast, u_saturation);
                col = toSrgb(clamp(col, 0.0, 1.0));
                
                fragColor = vec4(col, 1.0);
            }
        `;

        function createShader(type, src) {
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

        const vs = createShader(gl.VERTEX_SHADER, vsSource);
        const fs = createShader(gl.FRAGMENT_SHADER, fsSource);
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

        const quad = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);
        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);

        const aPos = gl.getAttribLocation(prog, 'position');
        gl.enableVertexAttribArray(aPos);
        gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

        const uRes = gl.getUniformLocation(prog, 'u_resolution');
        const uTime = gl.getUniformLocation(prog, 'u_time');
        const uScale = gl.getUniformLocation(prog, 'u_scale');
        const uSpeed = gl.getUniformLocation(prog, 'u_speed');
        const uSeed = gl.getUniformLocation(prog, 'u_seed');
        const uTurbAmp = gl.getUniformLocation(prog, 'u_turbAmp');
        const uTurbFreq = gl.getUniformLocation(prog, 'u_turbFreq');
        const uTurbIter = gl.getUniformLocation(prog, 'u_turbIter');
        const uWaveFreq = gl.getUniformLocation(prog, 'u_waveFreq');
        const uContrast = gl.getUniformLocation(prog, 'u_contrast');
        const uExposure = gl.getUniformLocation(prog, 'u_exposure');
        const uSaturation = gl.getUniformLocation(prog, 'u_saturation');
        const uDither = gl.getUniformLocation(prog, 'u_dither');
        const uColors = gl.getUniformLocation(prog, 'u_colors');

        // Colors: rgb(10, 18, 2), rgb(26, 46, 5), rgb(101, 163, 13), rgb(163, 230, 53)
        const colors = new Float32Array([
            10/255, 18/255, 2/255,
            26/255, 46/255, 5/255,
            101/255, 163/255, 13/255,
            163/255, 230/255, 53/255
        ]);

        gl.uniform3fv(uColors, colors);
        gl.uniform1f(uScale, 0.4);
        gl.uniform1f(uSpeed, 1.6);
        gl.uniform1f(uSeed, 32.0);
        gl.uniform1f(uTurbAmp, 0.6);
        gl.uniform1f(uTurbFreq, 0.1);
        gl.uniform1f(uTurbIter, 4.0);
        gl.uniform1f(uWaveFreq, 2.4);
        gl.uniform1f(uContrast, 1.1);
        gl.uniform1f(uExposure, 1.1);
        gl.uniform1f(uSaturation, 1.0);
        gl.uniform1f(uDither, 0.15);

        let isVisible = false;
        let animationId = null;

        function resize() {
            const rect = canvas.getBoundingClientRect();
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            const w = Math.round(rect.width * dpr);
            const h = Math.round(rect.height * dpr);
            if (w > 0 && h > 0 && (canvas.width !== w || canvas.height !== h)) {
                canvas.width = w;
                canvas.height = h;
                gl.viewport(0, 0, w, h);
                gl.uniform2f(uRes, w, h);
            }
        }

        resize();
        window.addEventListener('resize', resize);

        const startTime = performance.now();
        function render(now) {
            if (!isVisible) return;
            const elapsed = (now - startTime) * 0.001;
            gl.uniform1f(uTime, elapsed);
            gl.drawArrays(gl.TRIANGLES, 0, 6);
            animationId = requestAnimationFrame(render);
        }

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                isVisible = entry.isIntersecting;
                if (isVisible) {
                    resize();
                    if (!animationId) {
                        animationId = requestAnimationFrame(render);
                    }
                } else if (animationId) {
                    cancelAnimationFrame(animationId);
                    animationId = null;
                }
            });
        }, { threshold: 0.05 });

        observer.observe(btn);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initShaderButton);
    } else {
        initShaderButton();
    }
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
            { id: 'clients', num: '10', pill: 'TESTIMONIALS — CLIENT REVIEWS', kicker: 'Client', title: 'Experiences' },
            { id: 'about-myself', num: '11', pill: 'BIOGRAPHY — PERSONAL BACKGROUND', kicker: 'About', title: 'Myself' },
            { id: 'contact', num: '12', pill: 'CONNECT — GET IN TOUCH', kicker: "Let's", title: 'Work Together' },
            { id: 'quote', num: '13', pill: 'PHILOSOPHY — WORDS OF INSPIRATION', kicker: 'Favorite', title: 'Quotes' }
        ];

        sectionBadges.forEach(item => {
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

            // Inject Next-Taxonomy badge if not already present
            if (!section.querySelector('.taxonomy-section-badge')) {
                const badge = document.createElement('div');
                badge.className = 'taxonomy-section-badge';
                badge.setAttribute('aria-hidden', 'true');
                badge.innerHTML = `<span class="taxonomy-num">${item.num}</span><span class="taxonomy-pill">${item.pill}</span>`;
                titleEl.parentNode.insertBefore(badge, titleEl);
            }

            // Apply authentic Framer Text Reveal mask & inner words
            if (!titleEl.querySelector('.reveal-mask-wrapper')) {
                const words = item.title.split(' ');
                titleEl.innerHTML = `
                    <div class="reveal-mask-wrapper">
                        <span class="reveal-inner-word"><span class="taxonomy-serif-kicker">${item.kicker}</span></span>
                        ${words.map(w => `<span class="reveal-inner-word">${w}</span>`).join(' ')}
                    </div>
                `;
            }
        });

        // 2. Wrap any other section-titles (e.g. "Here's What I'm Doing")
        document.querySelectorAll('.section-title').forEach(title => {
            if (title.offsetParent === null && title.style.display === 'none') return;
            if (!title.querySelector('.reveal-mask-wrapper')) {
                const text = title.textContent.trim();
                if (!text) return;
                const parts = text.split(' ');
                const first = parts.shift();
                title.innerHTML = `
                    <div class="reveal-mask-wrapper">
                        <span class="reveal-inner-word"><span class="taxonomy-serif-kicker">${first}</span></span>
                        ${parts.map(w => `<span class="reveal-inner-word">${w}</span>`).join(' ')}
                    </div>
                `;
            }
        });

        // 2b. Wrap and prepare all section descriptions for Next-Taxonomy scroll reveal
        sectionBadges.forEach(item => {
            const section = document.getElementById(item.id);
            if (!section) return;

            let descEl = section.querySelector('.section-description, .experience-description, .education-description, .skills-description, .other-skills-description, .language-proficiency-description, .core-competencies-description, .taxonomy-description');
            if (!descEl && item.id === 'contact') {
                descEl = section.querySelector('.contact-info > p');
            }
            if (!descEl && item.id === 'about-myself') {
                descEl = section.querySelector('.about-myself__content p.desktop-only') || section.querySelector('.about-myself__content p');
            }
            if (!descEl && item.id === 'quote') {
                descEl = section.querySelector('.quote-text');
            }

            if (descEl && !descEl.querySelector('.reveal-inner-desc')) {
                descEl.classList.add('taxonomy-description');
                const originalHtml = descEl.innerHTML.trim();
                descEl.innerHTML = `
                    <div class="reveal-mask-wrapper taxonomy-desc-mask">
                        <span class="reveal-inner-desc">${originalHtml}</span>
                    </div>
                `;
            }

            // Hide old redundant badge inside #clients if present
            if (item.id === 'clients') {
                const oldLoomBadge = section.querySelector('.loom-badge');
                if (oldLoomBadge) oldLoomBadge.style.display = 'none';
            }
        });

        // 3. Direct IntersectionObserver for Next-Taxonomy Text Reveal when scrolling down
        const revealObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                const section = entry.target.closest('section') || entry.target.parentElement;
                const badge = section ? section.querySelector('.taxonomy-section-badge') : null;
                const words = entry.target.querySelectorAll('.reveal-inner-word, .reveal-inner-line, .text-reveal-line-inner');
                const descInner = section ? section.querySelector('.reveal-inner-desc') : null;

                if (entry.isIntersecting) {
                    if (badge) badge.classList.add('revealed');
                    words.forEach((w, idx) => {
                        setTimeout(() => {
                            w.classList.add('revealed');
                        }, idx * 70);
                    });
                    if (descInner) {
                        setTimeout(() => {
                            descInner.classList.add('revealed');
                        }, 160);
                    }
                } else {
                    const rect = entry.target.getBoundingClientRect();
                    if (rect.top > window.innerHeight) {
                        if (badge) badge.classList.remove('revealed');
                        words.forEach(w => w.classList.remove('revealed'));
                        if (descInner) descInner.classList.remove('revealed');
                    }
                }
            });
        }, {
            threshold: 0.12,
            rootMargin: '0px 0px -8% 0px'
        });

        // Directly observe every section-title and taxonomy-description
        document.querySelectorAll('.section-title').forEach(title => {
            revealObserver.observe(title);

            // Immediate reveal check if already visible on page load
            const r = title.getBoundingClientRect();
            if (r.top < window.innerHeight * 0.9 && r.bottom > 0) {
                const sec = title.closest('section') || title.parentElement;
                const badge = sec ? sec.querySelector('.taxonomy-section-badge') : null;
                if (badge) badge.classList.add('revealed');
                const words = title.querySelectorAll('.reveal-inner-word, .reveal-inner-line, .text-reveal-line-inner');
                words.forEach(w => w.classList.add('revealed'));
                const descInner = sec ? sec.querySelector('.reveal-inner-desc') : null;
                if (descInner) descInner.classList.add('revealed');
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
   About Myself Section: Framer "Unfocused" Shader Background
   Source: https://framer.com/m/Unfocused-s2wX.js@eLLQg8mahgg9ym0BzBhX
   ========================================================================== */
function initAboutMyselfUnfocusedBg() {
    const canvas = document.getElementById('aboutMyselfBgCanvas');
    const section = document.getElementById('about-myself');
    if (!canvas || !section) return;

    const gl = canvas.getContext('webgl', { alpha: true, antialias: true, premultipliedAlpha: false });
    if (!gl) return;

    const vsSource = `
        precision mediump float;
        attribute vec2 aPosition;
        varying vec2 vUv;
        varying vec2 vTextureCoord;
        uniform vec2 uMediaSize;
        uniform vec2 uPanelSize;
        uniform int uFitMode;

        void main() {
            vUv = aPosition * 0.5 + 0.5;
            if (uFitMode == 1) {
                vec2 ratio = vec2(
                    min((uPanelSize.x / uPanelSize.y) / (uMediaSize.x / uMediaSize.y), 1.0),
                    min((uPanelSize.y / uPanelSize.x) / (uMediaSize.y / uMediaSize.x), 1.0)
                );
                vTextureCoord = (vUv - 0.5) * ratio + 0.5;
            } else {
                vTextureCoord = vUv;
            }
            gl_Position = vec4(aPosition, 0.0, 1.0);
        }
    `;

    const fsSource = `
        precision mediump float;
        uniform sampler2D uTexture;
        uniform vec2 uMediaSize;
        uniform vec2 uPanelSize;
        
        uniform float uBlur;
        uniform float uFalloff;
        uniform float uFalloffType;
        uniform float uAngle;
        uniform vec2 uCenter;
        uniform float uDispersion;
        uniform float uNoise;
        uniform float uNoiseBlend;
        uniform float uScale;
        uniform vec2 uOrigin;

        varying vec2 vUv;
        varying vec2 vTextureCoord;
        
        const float PI2 = 6.28318530718;
        const int SAMPLES = 24;
        const float INV_SAMPLES = 1.0 / float(SAMPLES);
        const vec3 LUMA_WEIGHTS = vec3(0.299, 0.587, 0.114);
        const float MAX_DIST = 0.70710678118;
        
        float rand(vec2 co) {
            return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
        }
        
        float noise(vec2 uv) {
            return rand(uv) * 2.0 - 1.0;
        }
        
        vec2 applyRadialScale(vec2 uv, float scale) {
            vec2 fromCenter = uv - 0.5;
            float distance = length(fromCenter);
            if (distance < 0.001) return uv;
            float normalizedDistance = distance * 1.41421356237;
            float transformedDistance = pow(normalizedDistance, scale) * MAX_DIST;
            return 0.5 + normalize(fromCenter) * transformedDistance;
        }
        
        float calculateNoiseLuminanceFactor(float luminance, int blendMode) {
            if (blendMode == 0) return 1.0;
            float smoothLum = smoothstep(0.2, 0.8, luminance);
            if (blendMode == 1) return 1.0 - smoothLum * smoothLum;
            if (blendMode == 2) return smoothLum * smoothLum;
            if (blendMode == 3) {
                float centerBias = 1.0 - abs(luminance - 0.5) * 2.0;
                return max(pow(centerBias, 1.5), 0.1);
            }
            return 1.0;
        }
        
        float applyFalloff(float t, int falloffType) {
            if (falloffType == 1) return t * t;
            if (falloffType == 2) return t * t * t;
            if (falloffType == 3) return sqrt(t);
            return smoothstep(0.0, 1.0, t);
        }
        
        void main() {
            if (uBlur <= 0.0) {
                gl_FragColor = texture2D(uTexture, vTextureCoord);
                return;
            }
            
            vec2 scaledTextureCoord = applyRadialScale(vTextureCoord, 1.0 + uScale * 0.2);
            vec2 gradientDirection = vec2(cos(uAngle), sin(uAngle));
            
            vec2 fromOrigin = vUv - uOrigin;
            float projectionOnGradient = dot(fromOrigin, gradientDirection);
            float falloffDistance = clamp(max(projectionOnGradient, 0.0) / 0.7, 0.0, 1.0);
            
            int falloffType = int(uFalloffType + 0.5);
            float falloffCurve = applyFalloff(falloffDistance, falloffType);
            float reversedFalloff = 1.0 - falloffCurve;
            float blurStrength = mix(uBlur, reversedFalloff * uBlur, clamp(uFalloff, 0.0, 1.0));
            
            float dispersionFalloffStrength = mix(uDispersion, reversedFalloff * uDispersion, clamp(uFalloff, 0.0, 1.0));
            float dispersionStrength = dispersionFalloffStrength * blurStrength * 0.5;
            vec2 texelSize = 1.0 / uMediaSize;
            vec2 panelTexelRatio = uPanelSize / uMediaSize;
            float baseRadius = blurStrength * max(texelSize.x, texelSize.y) * max(panelTexelRatio.x, panelTexelRatio.y) * 0.5;
            vec2 dispersionDirection = vec2(-sin(uAngle), cos(uAngle));
            
            vec2 redOffset = dispersionDirection * dispersionStrength * texelSize * -0.7;
            vec2 blueOffset = dispersionDirection * dispersionStrength * texelSize * 0.7;
            
            vec3 channelColors = vec3(0.0);
            float totalWeight = 0.0;
            
            bool hasNoise = uNoise > 0.0;
            float noiseInfluence = uNoise * 0.3;
            
            for (int i = 0; i < SAMPLES; i++) {
                float fi = float(i);
                float angle = fi * INV_SAMPLES * PI2;
                vec2 circleDir = vec2(cos(angle), sin(angle));
                
                float randomOffset = rand(vec2(fi, vUv.x + vUv.y)) * 0.5 + 0.5;
                if (hasNoise) {
                    float noiseValue = noise(vUv + vec2(fi * 0.1));
                    randomOffset += noiseValue * noiseInfluence;
                }
                randomOffset = clamp(randomOffset, 0.1, 1.0);
                
                vec2 baseSampleOffset = circleDir * baseRadius * randomOffset;
                float baseWeight = 1.0 - smoothstep(0.0, 1.0, length(baseSampleOffset) / baseRadius);
                
                if (hasNoise) {
                    float weightNoise = noise(vUv + vec2(fi * 0.05 + 13.7));
                    baseWeight *= (1.0 + weightNoise * uNoise * 0.2);
                }
                baseWeight = max(baseWeight, 0.0);
                
                vec2 sampleCoord = clamp(scaledTextureCoord + baseSampleOffset, 0.0, 1.0);
                vec4 centerSample = texture2D(uTexture, sampleCoord);
                vec4 redSample = texture2D(uTexture, clamp(sampleCoord + redOffset, 0.0, 1.0));
                vec4 blueSample = texture2D(uTexture, clamp(sampleCoord + blueOffset, 0.0, 1.0));
                
                float weight = baseWeight;
                channelColors.r += redSample.r * redSample.a * weight;
                channelColors.g += centerSample.g * centerSample.a * weight;
                channelColors.b += blueSample.b * blueSample.a * weight;
                totalWeight += weight;
            }
            
            vec4 fallbackColor = texture2D(uTexture, scaledTextureCoord);
            channelColors = (totalWeight > 0.0) ? channelColors / totalWeight : fallbackColor.rgb * fallbackColor.a;
            
            if (hasNoise) {
                float finalNoise = noise(vUv * 10.0 + vec2(31.4, 17.2));
                float luminance = dot(channelColors, LUMA_WEIGHTS);
                
                float noiseStrength = uNoise;
                int blendMode = int(uNoiseBlend + 0.5);
                
                if (blendMode > 0) {
                    float luminanceFactor = calculateNoiseLuminanceFactor(luminance, blendMode);
                    noiseStrength *= luminanceFactor;
                }
                
                float adjustedNoise = finalNoise;
                if (blendMode == 3) {
                    if (luminance > 0.8) {
                        adjustedNoise = abs(finalNoise) * sign(finalNoise) * 0.3;
                    } else if (luminance < 0.2) {
                        adjustedNoise *= 0.5;
                    }
                }
                
                vec3 noiseContribution = vec3(adjustedNoise * noiseStrength * 0.1);
                channelColors = clamp(channelColors + noiseContribution, 0.0, 1.0);
            }
            
            float finalAlpha = max(fallbackColor.a, (blurStrength > 0.0) ? min(blurStrength * 0.01, 1.0) : 0.0);
            gl_FragColor = vec4(channelColors, finalAlpha);
        }
    `;

    function compileShader(type, src) {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        return s;
    }

    const vs = compileShader(gl.VERTEX_SHADER, vsSource);
    const fs = compileShader(gl.FRAGMENT_SHADER, fsSource);
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    gl.useProgram(prog);

    const posBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        -1, -1,  1, -1, -1,  1,
        -1,  1,  1, -1,  1,  1,
    ]), gl.STATIC_DRAW);

    const aPos = gl.getAttribLocation(prog, 'aPosition');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const uTexture = gl.getUniformLocation(prog, 'uTexture');
    const uMediaSize = gl.getUniformLocation(prog, 'uMediaSize');
    const uPanelSize = gl.getUniformLocation(prog, 'uPanelSize');
    const uFitMode = gl.getUniformLocation(prog, 'uFitMode');
    const uBlur = gl.getUniformLocation(prog, 'uBlur');
    const uFalloff = gl.getUniformLocation(prog, 'uFalloff');
    const uFalloffType = gl.getUniformLocation(prog, 'uFalloffType');
    const uAngle = gl.getUniformLocation(prog, 'uAngle');
    const uCenter = gl.getUniformLocation(prog, 'uCenter');
    const uDispersion = gl.getUniformLocation(prog, 'uDispersion');
    const uNoise = gl.getUniformLocation(prog, 'uNoise');
    const uNoiseBlend = gl.getUniformLocation(prog, 'uNoiseBlend');
    const uScale = gl.getUniformLocation(prog, 'uScale');
    const uOrigin = gl.getUniformLocation(prog, 'uOrigin');

    let currentTexture = null;
    let currentImage = null;
    const textures = { dark: null, light: null };
    const images = { dark: null, light: null };

    function createGLTexture(img) {
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        return tex;
    }

    function render() {
        if (!currentImage || !currentTexture) return;

        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const w = Math.floor(section.offsetWidth * dpr) || 1200;
        const h = Math.floor(section.offsetHeight * dpr) || 600;

        if (canvas.width !== w || canvas.height !== h) {
            canvas.width = w;
            canvas.height = h;
        }
        gl.viewport(0, 0, canvas.width, canvas.height);

        gl.useProgram(prog);
        gl.uniform2f(uMediaSize, currentImage.width, currentImage.height);
        gl.uniform2f(uPanelSize, canvas.width, canvas.height);
        gl.uniform1i(uFitMode, 1);
        gl.uniform1f(uBlur, 200.0);
        gl.uniform1f(uFalloff, 1.0);
        gl.uniform1f(uFalloffType, 0.0);
        gl.uniform1f(uAngle, 45.0 * Math.PI / 180.0);
        gl.uniform2f(uCenter, 0.5, 0.5);
        gl.uniform1f(uDispersion, 0.2);
        gl.uniform1f(uNoise, 1.0);
        gl.uniform1f(uNoiseBlend, 0.0);
        gl.uniform1f(uScale, 0.0);
        gl.uniform2f(uOrigin, 0.0, 0.5);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, currentTexture);
        gl.uniform1i(uTexture, 0);

        gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    function switchTheme(theme) {
        const isLight = theme === 'light';
        const key = isLight ? 'light' : 'dark';

        if (textures[key] && images[key]) {
            currentTexture = textures[key];
            currentImage = images[key];
            render();
            return;
        }

        const src = isLight ? 'assets/img/backgrounds/unfocused-light.jpg' : 'assets/img/backgrounds/unfocused-dark.jpg';
        const img = new Image();
        img.onload = () => {
            try {
                textures[key] = createGLTexture(img);
                images[key] = img;
                currentTexture = textures[key];
                currentImage = images[key];
                render();
            } catch (err) {
                // Graceful fallback if local file:// restrictions block texImage2D
            }
        };
        img.src = src;
    }

    const currentTheme = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
    switchTheme(currentTheme);

    const observer = new MutationObserver(() => {
        const newTheme = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
        switchTheme(newTheme);
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    let resizeTimer = null;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(render, 100);
    }, { passive: true });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAboutMyselfUnfocusedBg);
} else {
    initAboutMyselfUnfocusedBg();
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
