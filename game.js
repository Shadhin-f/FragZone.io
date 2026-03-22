// ==========================================
// FragZone.io - Main Game Logic (Three.js)
// ==========================================

// --- Output Audio ---
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
function playSound(type, distance = 0) {
    if (audioCtx.state === 'suspended') return;
    let volume = Math.max(0, 1 - (distance / 30)) * 0.15;
    if (volume <= 0) return;

    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    
    const now = audioCtx.currentTime;
    if (type === 'shoot') {
        osc.type = 'square';
        osc.frequency.setValueAtTime(150, now);
        osc.frequency.exponentialRampToValueAtTime(40, now + 0.1);
        gainNode.gain.setValueAtTime(volume, now);
        gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
        osc.start(now); osc.stop(now + 0.1);
    } else if (type === 'hit') {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(400, now);
        osc.frequency.exponentialRampToValueAtTime(100, now + 0.1);
        gainNode.gain.setValueAtTime(volume * 1.5, now);
        gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
        osc.start(now); osc.stop(now + 0.1);
    } else if (type === 'heal') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(400, now);
        osc.frequency.linearRampToValueAtTime(800, now + 0.3);
        gainNode.gain.setValueAtTime(volume * 0.8, now);
        gainNode.gain.linearRampToValueAtTime(0.01, now + 0.3);
        osc.start(now); osc.stop(now + 0.3);
    }
}

// --- State Variables ---
let scene, camera, renderer, clock, floor;
let isPlaying = false;
let mapSize = 100;
let obstacles = []; // For collisions
let bots = [];
let players = []; // Stores player and bots for scoreboard/minimap
let mapElements = []; // Store environment map elements to clear on restart
let healthDrops = []; // Health drop item tracking
let weaponDrops = [];
let ammoDrops = [];
let nextDropTime = 0;
let uiTimeout = null;
let menuBotMesh = null;
const textureLoader = new THREE.TextureLoader();

const WEAPONS = {
    pistol: { name: 'PISTOL', damage: 30, max: 15, reserve: 45, fireRate: 400, auto: false, recoil: 0.02 },
    shotgun: { name: 'SHOTGUN', damage: 100, max: 6, reserve: 24, fireRate: 800, auto: false, recoil: 0.1 },
    sniper: { name: 'SNIPER', damage: 100, max: 3, reserve: 15, fireRate: 1200, auto: false, recoil: 0.2 },
    ar: { name: 'AUTO RIFLE', damage: 30, max: 30, reserve: 90, fireRate: 150, auto: true, recoil: 0.05 }
};

// Player state
const player = {
    mesh: null,
    box: new THREE.Box3(),
    velocity: new THREE.Vector3(),
    direction: new THREE.Vector3(),
    speed: 15,
    runSpeed: 25,
    health: 100,
    ammo: WEAPONS.pistol.max,
    maxAmmo: WEAPONS.pistol.max,
    reserveAmmo: WEAPONS.pistol.reserve,
    currentWeapon: 'pistol',
    lastFireTime: 0,
    isAutoShooting: false,
    shieldTimer: 0,
    damageTimer: 0,
    score: 0,
    kills: 0,
    isDead: false,
    canJump: false,
    isADS: false,
    id: 'player',
    name: 'Player'
};

// Input state
const keys = { w: false, a: false, s: false, d: false, space: false, shift: false };
let isShooting = false;
let pitchObject = new THREE.Object3D(); // For vertical camera look
let yawObject = new THREE.Object3D();   // For horizontal camera look

function createItemMesh(type) {
    const group = new THREE.Group();
    let mainColor = 0xffaa00;
    
    if (type === 'ammo') {
        mainColor = 0x00aaff;
        const box = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.4, 0.5), new THREE.MeshStandardMaterial({ color: mainColor, emissive: mainColor, emissiveIntensity: 0.5 }));
        group.add(box);
    } else if (type === 'shield') {
        mainColor = 0x00ffff;
        const b = new THREE.Mesh(new THREE.DodecahedronGeometry(0.4), new THREE.MeshStandardMaterial({ color: mainColor, emissive: mainColor, emissiveIntensity: 0.8 }));
        group.add(b);
    } else if (type === 'damage') {
        mainColor = 0xff0000;
        const b = new THREE.Mesh(new THREE.OctahedronGeometry(0.4), new THREE.MeshStandardMaterial({ color: mainColor, emissive: mainColor, emissiveIntensity: 0.8 }));
        group.add(b);
    } else if (type === 'pistol') {
        mainColor = 0x888888;
        const mat = new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.6 });
        const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.4), mat); barrel.position.set(0, 0, -0.1);
        const handle = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.15, 0.1), new THREE.MeshStandardMaterial({ color: 0x111111 })); handle.position.set(0, -0.1, 0.05); handle.rotation.x = Math.PI / 8;
        group.add(barrel, handle);
        const sight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.04, 0.02), new THREE.MeshStandardMaterial({ color: 0x00f0ff, emissive: 0x00a0aa }));
        sight.position.set(0, 0.04, -0.28); group.add(sight);
    } else if (type === 'shotgun') {
        mainColor = 0xffaa00;
        const mat = new THREE.MeshStandardMaterial({ color: 0x444444, metalness: 0.8 });
        const b1 = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.8), mat); b1.rotation.x = Math.PI/2; b1.position.x = -0.05;
        const b2 = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.8), mat); b2.rotation.x = Math.PI/2; b2.position.x = 0.05;
        const stock = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.15, 0.3), new THREE.MeshStandardMaterial({color: 0x8b4513})); stock.position.set(0, -0.05, 0.4);
        group.add(b1, b2, stock);
    } else if (type === 'sniper') {
        mainColor = 0xffaa00;
        const mat = new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.5 });
        const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.2), mat); barrel.rotation.x = Math.PI/2; barrel.position.z = -0.2;
        const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.4), mat); scope.rotation.x = Math.PI/2; scope.position.y = 0.08; scope.position.z = 0.1;
        const body = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.15, 0.6), mat); body.position.z = 0.3; body.position.y = -0.05;
        group.add(barrel, scope, body);
    } else if (type === 'ar') {
        mainColor = 0xffaa00;
        const mat = new THREE.MeshStandardMaterial({ color: 0x334433, metalness: 0.3 });
        const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.8), mat); barrel.rotation.x = Math.PI/2; barrel.position.z = -0.1;
        const mag = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.2, 0.12), new THREE.MeshStandardMaterial({color: 0x111111})); mag.position.set(0, -0.15, 0.1);
        const body = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.15, 0.5), mat); body.position.z = 0.2; body.position.y = -0.02;
        group.add(barrel, mag, body);
    }
    
    // Add light to drops
    const light = new THREE.PointLight(mainColor, 1.0, 5);
    group.add(light);
    return group;
}

function updatePlayerGun(type) {
    if (player.gunMesh) pitchObject.remove(player.gunMesh);
    player.gunMesh = createItemMesh(type);
    player.gunMesh.children = player.gunMesh.children.filter(c => !(c instanceof THREE.PointLight)); // no light in hand
    player.gunMesh.position.set(0.2, -0.2, -0.5);
    pitchObject.add(player.gunMesh);
}

function createMenuBot() {
    const group = new THREE.Group();
    const botColor = new THREE.Color().setHSL(0.1, 0.8, 0.5); // Orange/Red hue for cool menu contrast

    const bodyMat = new THREE.MeshStandardMaterial({ color: botColor });
    const skinMat = new THREE.MeshStandardMaterial({ color: 0xffccaa });
    const blackMat = new THREE.MeshStandardMaterial({ color: 0x111111 });
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
    
    // Body (Shirt)
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 1.0, 16), bodyMat);
    body.position.y = 0.5; body.castShadow = true; body.receiveShadow = true; group.add(body);
    
    // Head
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), skinMat);
    head.position.y = 1.25; head.castShadow = true; head.receiveShadow = true; group.add(head);

    // Mask
    const mask = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.25, 0.42), blackMat);
    mask.position.y = 0.05; head.add(mask);

    // Eyes
    const eye = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.08, 0.05), eyeMat);
    eye.position.set(0, 0.05, -0.22); head.add(eye);

    // Arms
    const armGeo = new THREE.CylinderGeometry(0.1, 0.1, 0.8);
    const leftArm = new THREE.Mesh(armGeo, bodyMat);
    leftArm.position.set(-0.45, 0.6, 0); leftArm.castShadow = true;
    
    const rightArm = new THREE.Mesh(armGeo, bodyMat);
    rightArm.position.set(0.45, 0.6, 0); 
    rightArm.rotation.x = -Math.PI / 2; rightArm.position.set(0.45, 0.7, -0.3); rightArm.castShadow = true;
    group.add(leftArm, rightArm);

    // Legs
    const legGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.8);
    const leftLeg = new THREE.Mesh(legGeo, blackMat); leftLeg.position.set(-0.15, -0.4, 0); leftLeg.castShadow = true;
    const rightLeg = new THREE.Mesh(legGeo, blackMat); rightLeg.position.set(0.15, -0.4, 0); rightLeg.castShadow = true;
    group.add(leftLeg, rightLeg);

    // Give him an AR
    const gun = createItemMesh('ar');
    gun.position.set(0, -0.5, -0.15); 
    // remove point light
    gun.children = gun.children.filter(c => !(c instanceof THREE.PointLight));
    rightArm.add(gun);

    group.position.set(0, 1.6, -7);
    group.rotation.y = Math.PI / 6;
    group.userData.baseY = 1.6;
    group.userData.rotSpeed = 0.2;
    
    return group;
}

// --- Initialization ---
function init() {
    // Scene setup
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0e17);
    scene.fog = new THREE.Fog(0x0a0e17, 10, mapSize * 0.8);

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    
    // Player hierarchy for mouselook
    yawObject.add(pitchObject);
    pitchObject.add(camera);
    scene.add(yawObject);
    // Move player up
    yawObject.position.y = 1.6;

    // Create pistol model
    updatePlayerGun('pistol');

    // Add player point light
    const playerLight = new THREE.PointLight(0xffffff, 0.8, 15);
    playerLight.position.set(0, 1, 0);
    yawObject.add(playerLight);

    // Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.getElementById('gameContainer').appendChild(renderer.domElement);

    clock = new THREE.Clock();

    // Lighting
    const ambientLight = new THREE.AmbientLight(0x404040, 1.5);
    scene.add(ambientLight);

    // Arena extra lights
    const light1 = new THREE.PointLight(0x00f0ff, 1, 60);
    light1.position.set(20, 10, 20);
    scene.add(light1);
    
    const light2 = new THREE.PointLight(0xff2d55, 1, 60);
    light2.position.set(-20, 10, -20);
    scene.add(light2);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.4);
    dirLight.position.set(50, 100, 50);
    dirLight.castShadow = true;
    dirLight.shadow.camera.left = -mapSize;
    dirLight.shadow.camera.right = mapSize;
    dirLight.shadow.camera.top = mapSize;
    dirLight.shadow.camera.bottom = -mapSize;
    scene.add(dirLight);

    // Build Environment
    createMap();
    
    menuBotMesh = createMenuBot();
    scene.add(menuBotMesh);

    // Listeners
    setupControls();
    window.addEventListener('resize', onWindowResize, false);

    // Initial HUD update
    updateHUD();

    // High Score UI Update
    const updateHighScoreDisplay = () => {
        const activeBtn = document.querySelector('.bot-btn.active');
        if (activeBtn) {
            const count = activeBtn.dataset.count;
            const hs = localStorage.getItem('highscore_' + count) || 0;
            const hsEl = document.getElementById('highScoreText');
            if (hsEl) hsEl.textContent = 'High Score: ' + hs;
        }
    };
    updateHighScoreDisplay(); // initial load

    // Start UI
    document.getElementById('playButton').addEventListener('click', () => {
        if (audioCtx.state === 'suspended') audioCtx.resume();
        startGame();
    });
    
    document.getElementById('playAgainBtn').addEventListener('click', () => {
        if (audioCtx.state === 'suspended') audioCtx.resume();
        startGame();
    });

    document.getElementById('mainMenuBtn').addEventListener('click', () => {
        returnToMenu();
    });
    
    document.getElementById('tutorialBtn').addEventListener('click', () => {
        document.getElementById('tutorialModal').classList.remove('hidden');
    });

    document.getElementById('closeTutorialBtn').addEventListener('click', () => {
        document.getElementById('tutorialModal').classList.add('hidden');
    });
    
    const botBtns = document.querySelectorAll('.bot-btn');
    botBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            botBtns.forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            updateHighScoreDisplay();
        });
    });

    animate();
}

const THEMES = ['prison', 'house', 'park', 'office', 'snow', 'desert', 'jungle'];

function createMap() {
    // Clean up previous map
    mapElements.forEach(el => scene.remove(el));
    mapElements = [];
    obstacles = [];
    
    // Choose theme
    const theme = THEMES[Math.floor(Math.random() * THEMES.length)];
    
    // Theme Colors
    let floorColor, wallColor, elemMat, secondaryMat;
    
    if (theme === 'prison') {
        floorColor = 0x1a2536; wallColor = 0x0f1a2e;
        elemMat = new THREE.MeshStandardMaterial({ color: 0x3a3f47, roughness: 0.9, metalness: 0.1 }); // Concrete
        secondaryMat = new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.8 }); // Bars
    } else if (theme === 'park') {
        floorColor = 0x2d4c1e; wallColor = 0x5c4033;
        elemMat = new THREE.MeshStandardMaterial({ color: 0x1e3f11, roughness: 1.0 }); // Bushes/Trees
        secondaryMat = new THREE.MeshStandardMaterial({ color: 0x8b5a2b, roughness: 0.9 }); // Trunks/Benches
    } else if (theme === 'house') {
        floorColor = 0x8b7355; wallColor = 0xf5f5dc;
        elemMat = new THREE.MeshStandardMaterial({ color: 0x4a3c31, roughness: 0.8 }); // Furniture
        secondaryMat = new THREE.MeshStandardMaterial({ color: 0xa0522d, roughness: 0.7 }); // Tables
    } else if (theme === 'snow') {
        floorColor = 0xeeeeee; wallColor = 0xb0c4de;
        elemMat = new THREE.MeshStandardMaterial({ color: 0xadd8e6, roughness: 0.2, transparent: true, opacity: 0.8 }); // Ice
        secondaryMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1.0 }); // Snow mound
    } else if (theme === 'desert') {
        floorColor = 0xedc9af; wallColor = 0xc2b280;
        elemMat = new THREE.MeshStandardMaterial({ color: 0x2e8b57, roughness: 0.8 }); // Cactus
        secondaryMat = new THREE.MeshStandardMaterial({ color: 0xd2b48c, roughness: 0.9 }); // Sandstone block
    } else if (theme === 'jungle') {
        floorColor = 0x0f290b; wallColor = 0x3b5e2b;
        elemMat = new THREE.MeshStandardMaterial({ color: 0x144512, roughness: 1.0 }); // Leaves
        secondaryMat = new THREE.MeshStandardMaterial({ color: 0x4a3018, roughness: 0.9 }); // Huge trunks
    } else { // office
        floorColor = 0x808080; wallColor = 0xffffff;
        elemMat = new THREE.MeshStandardMaterial({ color: 0xaaaaaa, roughness: 0.5, metalness: 0.4 }); // Cubicles
        secondaryMat = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.5 }); // Desks
    }

    // Floor
    const floorGeo = new THREE.PlaneGeometry(mapSize, mapSize);
    const floorMat = new THREE.MeshStandardMaterial({ color: floorColor, roughness: 0.8 });
    
    // Add grid only for digital looking themes if we want, or keep it generic
    floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    floor.userData.isWall = true;
    scene.add(floor);
    mapElements.push(floor);

    // Walls
    const wallGeo = new THREE.BoxGeometry(mapSize, 10, 1);
    const wallMatExt = new THREE.MeshStandardMaterial({ color: wallColor });
    
    const borders = [
        { x: 0, z: -mapSize/2, rotY: 0 },
        { x: 0, z: mapSize/2, rotY: 0 },
        { x: -mapSize/2, z: 0, rotY: Math.PI/2 },
        { x: mapSize/2, z: 0, rotY: Math.PI/2 }
    ];

    borders.forEach(w => {
        const wall = new THREE.Mesh(wallGeo, wallMatExt);
        wall.position.set(w.x, 5, w.z);
        wall.rotation.y = w.rotY;
        wall.receiveShadow = true;
        wall.castShadow = true;
        scene.add(wall);
        mapElements.push(wall);
        
        const box = new THREE.Box3().setFromObject(wall);
        obstacles.push(box);
    });

    // Populate elements
    const blockGeo = new THREE.BoxGeometry(1, 1, 1);
    const barGeo = new THREE.CylinderGeometry(0.05, 0.05, 4, 8);
    const cylGeo = new THREE.CylinderGeometry(1, 1, 1, 16);
    
    for (let i = 0; i < 40; i++) {
        const group = new THREE.Group();
        const typeRand = Math.random();
        let collider;
        
        if (theme === 'prison') {
            if (typeRand > 0.4) {
                const w = 4 + Math.random() * 8; const h = 6 + Math.random() * 6; const d = 2 + Math.random() * 4;
                const block = new THREE.Mesh(blockGeo, elemMat);
                block.scale.set(w, h, d); block.position.y = h / 2; block.castShadow = true; block.receiveShadow = true;
                group.add(block); collider = block;
            } else {
                const w = 6; const h = 4;
                const fTop = new THREE.Mesh(blockGeo, elemMat); fTop.scale.set(w, 0.5, 0.5); fTop.position.y = h - 0.25; fTop.castShadow = true; group.add(fTop);
                const fBot = new THREE.Mesh(blockGeo, elemMat); fBot.scale.set(w, 0.5, 0.5); fBot.position.y = 0.25; fBot.castShadow = true; group.add(fBot);
                for(let b = 0; b < 10; b++) {
                    const bar = new THREE.Mesh(barGeo, secondaryMat); bar.position.set(-w/2 + 0.3 + b*0.6, h/2, 0); bar.castShadow = true; group.add(bar);
                }
                collider = new THREE.Mesh(blockGeo, new THREE.MeshBasicMaterial({visible: false}));
                collider.scale.set(w, h, 0.5); collider.position.y = h/2; group.add(collider);
            }
        } else if (theme === 'park') {
            if (typeRand > 0.5) {
                // Trees
                const trunk = new THREE.Mesh(cylGeo, secondaryMat);
                trunk.scale.set(0.6, 3, 0.6); trunk.position.y = 1.5; trunk.castShadow = true; group.add(trunk);
                const leaves = new THREE.Mesh(new THREE.DodecahedronGeometry(2.5), elemMat);
                leaves.position.y = 4; leaves.castShadow = true; group.add(leaves);
                collider = new THREE.Mesh(blockGeo, new THREE.MeshBasicMaterial({visible: false}));
                collider.scale.set(1.5, 5, 1.5); collider.position.y = 2.5; group.add(collider);
            } else {
                // Hedges
                const w = 4 + Math.random() * 6; const h = 2 + Math.random() * 2; const d = 2;
                const hedge = new THREE.Mesh(blockGeo, elemMat);
                hedge.scale.set(w, h, d); hedge.position.y = h/2; hedge.castShadow = true; hedge.receiveShadow = true;
                group.add(hedge); collider = hedge;
            }
        } else if (theme === 'house') {
            if (typeRand > 0.6) {
                // Walls
                const w = 8 + Math.random() * 6; const h = 6; const d = 1;
                const wall = new THREE.Mesh(blockGeo, wallMatExt); 
                wall.scale.set(w, h, d); wall.position.y = h/2; wall.castShadow = true; wall.receiveShadow = true;
                group.add(wall); collider = wall;
            } else {
                // Wardrobe / Furniture
                const w = 3; const h = 4 + Math.random(); const d = 2;
                const furn = new THREE.Mesh(blockGeo, secondaryMat);
                furn.scale.set(w, h, d); furn.position.y = h/2; furn.castShadow = true; furn.receiveShadow = true;
                group.add(furn); collider = furn;
            }
        } else if (theme === 'snow') {
            if (typeRand > 0.5) {
                // Ice block
                const w = 4 + Math.random() * 4; const h = 4 + Math.random() * 4; const d = 4 + Math.random() * 4;
                const ice = new THREE.Mesh(blockGeo, elemMat);
                ice.scale.set(w, h, d); ice.position.y = h/2; ice.castShadow = true; ice.receiveShadow = true;
                group.add(ice); collider = ice;
            } else {
                // Snow mound
                const rad = 2 + Math.random() * 3;
                const moundGeo = new THREE.DodecahedronGeometry(rad);
                const mound = new THREE.Mesh(moundGeo, secondaryMat);
                mound.position.y = 0; mound.castShadow = true; mound.receiveShadow = true;
                group.add(mound);
                
                collider = new THREE.Mesh(blockGeo, new THREE.MeshBasicMaterial({visible: false}));
                collider.scale.set(rad*1.5, rad*1.5, rad*1.5); collider.position.y = rad; group.add(collider);
            }
        } else if (theme === 'desert') {
            if (typeRand > 0.6) {
                // Cactus
                const h = 4 + Math.random() * 4;
                const cactus = new THREE.Mesh(cylGeo, elemMat);
                cactus.scale.set(0.8, h, 0.8); cactus.position.y = h/2; cactus.castShadow = true; group.add(cactus);
                
                // Cactus arms
                const arm1 = new THREE.Mesh(cylGeo, elemMat);
                arm1.scale.set(0.6, 2, 0.6); arm1.position.set(0.8, h*0.6, 0); arm1.rotation.z = Math.PI/4; group.add(arm1);
                
                collider = new THREE.Mesh(blockGeo, new THREE.MeshBasicMaterial({visible: false}));
                collider.scale.set(2.5, h, 2.5); collider.position.y = h/2; group.add(collider);
            } else {
                // Sandstone block
                const w = 5 + Math.random()*5; const h = 3 + Math.random()*5; const d = 5 + Math.random()*5;
                const rock = new THREE.Mesh(blockGeo, secondaryMat);
                rock.scale.set(w, h, d); rock.position.y = h/2; rock.castShadow = true; rock.receiveShadow = true;
                group.add(rock); collider = rock;
            }
        } else if (theme === 'jungle') {
            // Massive trees
            const h = 10 + Math.random() * 10;
            const trunk = new THREE.Mesh(cylGeo, secondaryMat);
            trunk.scale.set(2 + Math.random(), h, 2 + Math.random()); trunk.position.y = h/2; trunk.castShadow = true; group.add(trunk);
            const leaves = new THREE.Mesh(new THREE.DodecahedronGeometry(6 + Math.random() * 4), elemMat);
            leaves.position.y = h; leaves.castShadow = true; group.add(leaves);
            collider = new THREE.Mesh(blockGeo, new THREE.MeshBasicMaterial({visible: false}));
            collider.scale.set(4, h, 4); collider.position.y = h/2; group.add(collider);
        } else { // Office
            if (typeRand > 0.4) {
                // Cubicle walls
                const w = 6 + Math.random() * 4; const h = 3.5; const d = 0.5;
                const cubi = new THREE.Mesh(blockGeo, elemMat);
                cubi.scale.set(w, h, d); cubi.position.y = h/2; cubi.castShadow = true; cubi.receiveShadow = true;
                group.add(cubi); collider = cubi;
            } else {
                // Big server racks or copy machines
                const w = 2.5; const h = 5; const d = 2.5;
                const rack = new THREE.Mesh(blockGeo, secondaryMat);
                rack.scale.set(w, h, d); rack.position.y = h/2; rack.castShadow = true; rack.receiveShadow = true;
                group.add(rack); collider = rack;
            }
        }
        
        group.position.x = (Math.random() - 0.5) * (mapSize - 15);
        group.position.z = (Math.random() - 0.5) * (mapSize - 15);
        group.rotation.y = Math.random() > 0.5 ? 0 : Math.PI / 2;
        
        // Keep center clear, let player spawn safe
        if (Math.abs(group.position.x) < 12 && Math.abs(group.position.z) < 12) continue;

        scene.add(group);
        mapElements.push(group);
        group.updateMatrixWorld(true);
        collider.updateMatrixWorld(true);
        collider.userData.isWall = true;
        obstacles.push(new THREE.Box3().setFromObject(collider));
    }
}

// --- Input Controls ---
function setupControls() {
    document.addEventListener('keydown', (e) => {
        if (!isPlaying || player.isDead) return;
        switch(e.code) {
            case 'KeyW': keys.w = true; break;
            case 'KeyA': keys.a = true; break;
            case 'KeyS': keys.s = true; break;
            case 'KeyD': keys.d = true; break;
            case 'Space': 
                if (player.canJump) {
                    player.velocity.y = 10;
                    player.canJump = false;
                }
                break;
            case 'ShiftLeft': keys.shift = true; break;
            case 'KeyR': reload(); break;
        }
    });

    document.addEventListener('keyup', (e) => {
        switch(e.code) {
            case 'KeyW': keys.w = false; break;
            case 'KeyA': keys.a = false; break;
            case 'KeyS': keys.s = false; break;
            case 'KeyD': keys.d = false; break;
            case 'ShiftLeft': keys.shift = false; break;
        }
    });

    document.addEventListener('mousedown', (e) => {
        if (isPlaying && !player.isDead && document.pointerLockElement) {
            if (e.button === 0) {
                const w = WEAPONS[player.currentWeapon];
                if (w.auto) player.isAutoShooting = true;
                shoot();
            }
            if (e.button === 2) { // Right click for ADS
                player.isADS = true;
                camera.fov = player.currentWeapon === 'sniper' ? 15 : 40;
                camera.updateProjectionMatrix();
                if (player.gunMesh) {
                    player.gunMesh.position.set(0, -0.12, -0.3); // Center gun
                }
            }
        }
    });

    document.addEventListener('mouseup', (e) => {
        if (isPlaying && !player.isDead) {
            if (e.button === 0) {
                player.isAutoShooting = false;
            }
            if (e.button === 2) {
                player.isADS = false;
                camera.fov = 75;
                camera.updateProjectionMatrix();
                if (player.gunMesh) {
                    player.gunMesh.position.set(0.2, -0.2, -0.5); // Reset gun
                }
            }
        }
    });

    document.addEventListener('mousemove', (e) => {
        if (document.pointerLockElement) {
            const movementX = e.movementX || e.mozMovementX || e.webkitMovementX || 0;
            const movementY = e.movementY || e.mozMovementY || e.webkitMovementY || 0;

            const sensitivity = player.isADS ? 0.001 : 0.002;
            yawObject.rotation.y -= movementX * sensitivity;
            pitchObject.rotation.x -= movementY * sensitivity;

            // Clamp pitch
            pitchObject.rotation.x = Math.max(-Math.PI/2, Math.min(Math.PI/2, pitchObject.rotation.x));
        }
    });

    document.addEventListener('contextmenu', (e) => {
        if (isPlaying || document.pointerLockElement) {
            e.preventDefault();
        }
    });

    document.addEventListener('pointerlockchange', () => {
        if (document.pointerLockElement) {
            isPlaying = true;
            document.getElementById('startScreen').classList.add('hidden');
            if(!player.isDead) document.getElementById('hud').classList.remove('hidden');
        } else {
            isPlaying = false;
            if(!player.isDead) {
                document.getElementById('startScreen').classList.remove('hidden');
                document.getElementById('hud').classList.add('hidden');
            }
        }
    });
}

function startGame() {
    createMap(); // Regenerate new random map
    
    if (menuBotMesh) menuBotMesh.visible = false;
    
    const nameInput = document.getElementById('playerName').value;
    player.name = nameInput.trim() || 'Player';
    
    // Get bot count
    let botCount = 5;
    const activeBtn = document.querySelector('.bot-btn.active');
    if (activeBtn) botCount = parseInt(activeBtn.dataset.count);

    // Reset game state
    yawObject.position.set(0, 1.6, 0);
    player.health = 100;
    player.currentWeapon = 'pistol';
    player.maxAmmo = WEAPONS.pistol.max;
    player.ammo = player.maxAmmo;
    player.reserveAmmo = WEAPONS.pistol.reserve;
    player.isAutoShooting = false;
    player.score = 0;
    player.isDead = false;
    document.getElementById('weaponName').textContent = WEAPONS.pistol.name;
    nextDropTime = Date.now() + 10000;
    
    players = [{ id: player.id, name: player.name, score: 0, isPlayer: true }];
    
    spawnBots(botCount);
    updateHUD();
    
    document.getElementById('hud').classList.remove('hidden');
    document.getElementById('startScreen').classList.add('hidden');
    document.getElementById('respawnScreen').classList.add('hidden');
    
    // Request pointer lock
    document.body.requestPointerLock();
}

// --- Player Logic ---
function updatePlayer(dt) {
    if (!isPlaying || player.isDead) return;

    // Movement
    const speed = keys.shift ? player.runSpeed : player.speed;
    
    player.direction.z = Number(keys.s) - Number(keys.w);
    player.direction.x = Number(keys.d) - Number(keys.a);
    player.direction.normalize(); // Ensure consistent speed in all directions

    // Friction and gravity
    player.velocity.x -= player.velocity.x * 10.0 * dt;
    player.velocity.z -= player.velocity.z * 10.0 * dt;
    player.velocity.y -= 30.0 * dt; // gravity

    if (player.direction.z !== 0 || player.direction.x !== 0) {
        // Move in facing direction
        const vector = new THREE.Vector3(player.direction.x, 0, player.direction.z);
        vector.applyQuaternion(yawObject.quaternion);
        
        player.velocity.x += vector.x * speed * dt * 10;
        player.velocity.z += vector.z * speed * dt * 10;
    }

    const oldPos = yawObject.position.clone();

    // Apply XZ translation
    yawObject.position.x += player.velocity.x * dt;
    yawObject.position.z += player.velocity.z * dt;
    
    // XZ Collision
    if (checkCollision(yawObject.position)) {
        yawObject.position.x = oldPos.x;
        yawObject.position.z = oldPos.z;
        player.velocity.x = 0;
        player.velocity.z = 0;
    }

    // Apply Y translation
    yawObject.position.y += player.velocity.y * dt;

    if (yawObject.position.y < 1.6) {
        player.velocity.y = 0;
        yawObject.position.y = 1.6;
        player.canJump = true;
    }
}

function checkCollision(pos, radius = 0.5) {
    // Simple AABB collision test
    const minX = pos.x - radius;
    const maxX = pos.x + radius;
    const minZ = pos.z - radius;
    const maxZ = pos.z + radius;
    // Y approx
    const minY = pos.y - 1.5;
    const maxY = pos.y + 0.5;

    for (let i = 0; i < obstacles.length; i++) {
        const box = obstacles[i];
        if (maxX > box.min.x && minX < box.max.x &&
            maxZ > box.min.z && minZ < box.max.z &&
            maxY > box.min.y && minY < box.max.y) {
            return true;
        }
    }
    return false;
}

// --- Combat ---
function shoot() {
    const w = WEAPONS[player.currentWeapon];
    if (Date.now() - player.lastFireTime < w.fireRate) return;
    if (player.ammo <= 0) return;
    
    player.lastFireTime = Date.now();
    player.ammo--;
    updateHUD();

    playSound('shoot', 0);
    
    // Crosshair animation
    const ch = document.getElementById('crosshair');
    ch.classList.add('shooting');
    setTimeout(() => ch.classList.remove('shooting'), 100);

    // Gun kick animation
    if (player.gunMesh) {
        player.gunMesh.position.z += w.recoil;
        player.gunMesh.rotation.x -= w.recoil * 2;
        setTimeout(() => {
            if (player.gunMesh) {
                player.gunMesh.position.z -= w.recoil;
                player.gunMesh.rotation.x += w.recoil * 2;
            }
        }, 80);
    }

    // Muzzle flash / Tracer effect
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    
    if (w.auto && !player.isADS) {
        raycaster.ray.direction.x += (Math.random() - 0.5) * 0.05;
        raycaster.ray.direction.y += (Math.random() - 0.5) * 0.05;
        raycaster.ray.direction.normalize();
    }

    // Create tracer line
    const points = [];
    points.push(new THREE.Vector3(0.3, -0.3, -1).applyMatrix4(camera.matrixWorld));
    
    // Calculate intersection
    const intersects = raycaster.intersectObjects(scene.children, true);
    
    let hitBot = null;
    let endPoint = camera.position.clone().add(raycaster.ray.direction.multiplyScalar(100));

    if (intersects.length > 0) {
        for (let i = 0; i < intersects.length; i++) {
            const hit = intersects[i];
            
            // Wall intersection glitch fix
            if (hit.object === floor || hit.object.userData.isWall) {
                endPoint = hit.point;
                break;
            }
            
            // Check bots
            const bot = getBotFromMesh(hit.object);
            if (bot) {
                endPoint = hit.point;
                hitBot = { instance: bot, object: hit.object };
                break;
            }
        }
    }

    points.push(endPoint);
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({ color: 0xffff00 });
    const tracer = new THREE.Line(geometry, material);
    scene.add(tracer);

    setTimeout(() => {
        scene.remove(tracer);
        geometry.dispose();
        material.dispose();
    }, 50);

    if (hitBot) {
        playSound('hit', 0);
        let dmg = w.damage;
        if (Date.now() < player.damageTimer) dmg *= 2; // Powerup modifier
        
        if (player.currentWeapon === 'shotgun') {
            const dist = camera.position.distanceTo(endPoint);
            dmg = dist > 20 ? 30 : Math.min(100, dmg * 2);
        } else {
            const isHead = hitBot.object.name === 'head' || (hitBot.object.parent && hitBot.object.parent.name === 'head');
            dmg = isHead ? 100 : dmg;
        }
        hitBot.instance.takeDamage(dmg, player.id);
        
        // Show hit marker
        const hm = document.getElementById('hitMarker');
        hm.classList.add('show');
        setTimeout(() => hm.classList.remove('show'), 200);
    }
}

function reload() {
    if (player.reserveAmmo <= 0 || player.ammo === player.maxAmmo) return;
    
    const needed = player.maxAmmo - player.ammo;
    const canTake = Math.min(needed, player.reserveAmmo);
    
    // Simulate reload time
    setTimeout(() => {
        player.ammo += canTake;
        player.reserveAmmo -= canTake;
        updateHUD();
    }, 1000);
}

function takeDamage(amount, sourceName) {
    if (Date.now() < player.shieldTimer) {
        playSound('hit', 0); // indicate hit but bounce off
        return;
    }
    player.health -= amount;
    
    const overlay = document.getElementById('damageOverlay');
    overlay.classList.add('hit');
    setTimeout(() => overlay.classList.remove('hit'), 300);

    updateHUD();

    if (player.health <= 0) {
        // Save high score
        const activeBtn = document.querySelector('.bot-btn.active');
        if (activeBtn) {
            const count = activeBtn.dataset.count;
            const hsKey = 'highscore_' + count;
            const currentHS = parseInt(localStorage.getItem(hsKey) || 0);
            if (player.score > currentHS) {
                localStorage.setItem(hsKey, player.score);
            }
            // Update ui locally on death if needed
            const hsEl = document.getElementById('highScoreText');
            if (hsEl) hsEl.textContent = 'High Score: ' + Math.max(currentHS, player.score);
        }
        die(sourceName);
    }
}

function die(killerName) {
    player.isDead = true;
    document.exitPointerLock();
    document.getElementById('hud').classList.add('hidden');
    
    const rs = document.getElementById('respawnScreen');
    rs.classList.remove('hidden');
    document.getElementById('killedBy').textContent = killerName || 'Unknown';
    const fv = document.getElementById('finalScoreVal');
    if (fv) fv.textContent = player.score;
}

function returnToMenu() {
    document.getElementById('respawnScreen').classList.add('hidden');
    document.getElementById('startScreen').classList.remove('hidden');
    
    yawObject.position.set(0, 1.6, 0);
    yawObject.rotation.set(0, 0, 0);
    pitchObject.rotation.set(0, 0, 0);
    
    if (menuBotMesh) {
        menuBotMesh.visible = true;
        menuBotMesh.position.set(0, 1.6, -7);
    }
    
    const activeBtn = document.querySelector('.bot-btn.active');
    if (activeBtn) {
        const count = activeBtn.dataset.count;
        const hs = localStorage.getItem('highscore_' + count) || 0;
        const hsEl = document.getElementById('highScoreText');
        if (hsEl) hsEl.textContent = 'High Score: ' + hs;
    }
}

function respawn() {
    player.health = 100;
    player.currentWeapon = 'pistol';
    player.maxAmmo = WEAPONS.pistol.max;
    player.ammo = player.maxAmmo;
    player.reserveAmmo = WEAPONS.pistol.reserve;
    player.isDead = false;
    player.isAutoShooting = false;
    document.getElementById('weaponName').textContent = WEAPONS.pistol.name;
    
    // Random position
    yawObject.position.set(
        (Math.random() - 0.5) * (mapSize - 20),
        1.6,
        (Math.random() - 0.5) * (mapSize - 20)
    );
    
    document.getElementById('respawnScreen').classList.add('hidden');
    document.getElementById('startScreen').classList.remove('hidden');
    // document.body.requestPointerLock(); // Let them click play again or auto lock
}

function wallsContains(obj) {
    return obstacles.some(b => b.intersectsBox(new THREE.Box3().setFromObject(obj)));
}

// --- AI Bots ---
const BotNames = ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Ghost", "Viper", "Hawk", "Jester", "Zeus", "Apollo"];

class Bot {
    constructor(id) {
        this.id = 'bot_' + id;
        this.name = BotNames[id % BotNames.length] + '_' + Math.floor(Math.random()*99);
        this.health = 100;
        this.score = 0;
        this.state = 'wander'; // wander, chase, attack
        this.lastShot = 0;
        this.target = null;
        
        // Setup mesh (Group)
        this.mesh = new THREE.Group();
        this.mesh.userData = { bot: this };
        
        // Random color
        const botColor = new THREE.Color().setHSL(Math.random(), 0.8, 0.5);

        // Body (Shirt)
        const bodyGeo = new THREE.CylinderGeometry(0.35, 0.35, 1.0, 16);
        const bodyMat = new THREE.MeshStandardMaterial({ color: botColor });
        const body = new THREE.Mesh(bodyGeo, bodyMat);
        body.position.y = 0.5; // lower body
        body.castShadow = true;
        body.receiveShadow = true;
        body.userData = { bot: this };
        this.mesh.add(body);
        
        // Head
        const headGeo = new THREE.BoxGeometry(0.4, 0.4, 0.4);
        const headMat = new THREE.MeshStandardMaterial({ color: 0xffccaa }); // skin
        const head = new THREE.Mesh(headGeo, headMat);
        head.position.y = 1.25;
        head.name = 'head';
        head.castShadow = true;
        head.receiveShadow = true;
        head.userData = { bot: this };
        this.mesh.add(head);

        // Mask (Robber look)
        const maskGeo = new THREE.BoxGeometry(0.42, 0.25, 0.42);
        const maskMat = new THREE.MeshStandardMaterial({ color: 0x111111 });
        const mask = new THREE.Mesh(maskGeo, maskMat);
        mask.position.y = 0.05;
        mask.userData = { bot: this };
        head.add(mask);

        // Eyes
        const eyeGeo = new THREE.BoxGeometry(0.35, 0.08, 0.05);
        const eyeMat = new THREE.MeshStandardMaterial({ color: 0xffffff }); // eye hole
        const eye = new THREE.Mesh(eyeGeo, eyeMat);
        eye.position.set(0, 0.05, -0.22);
        eye.userData = { bot: this };
        head.add(eye);

        // Arms
        const armGeo = new THREE.CylinderGeometry(0.1, 0.1, 0.8);
        const armMat = new THREE.MeshStandardMaterial({ color: botColor });
        
        const leftArm = new THREE.Mesh(armGeo, armMat);
        leftArm.position.set(-0.45, 0.6, 0);
        leftArm.userData = { bot: this }; leftArm.castShadow = true;
        
        const rightArm = new THREE.Mesh(armGeo, armMat);
        rightArm.position.set(0.45, 0.6, 0); 
        // Right arm holding gun
        rightArm.rotation.x = -Math.PI / 2;
        rightArm.position.y = 0.7; rightArm.position.z = -0.3;
        rightArm.userData = { bot: this }; rightArm.castShadow = true;

        this.mesh.add(leftArm, rightArm);

        // Legs
        const legGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.8);
        const legMat = new THREE.MeshStandardMaterial({ color: 0x222222 }); // Black pants
        
        const leftLeg = new THREE.Mesh(legGeo, legMat);
        leftLeg.position.set(-0.15, -0.4, 0); leftLeg.userData = { bot: this }; leftLeg.castShadow = true;
        const rightLeg = new THREE.Mesh(legGeo, legMat);
        rightLeg.position.set(0.15, -0.4, 0); rightLeg.userData = { bot: this }; rightLeg.castShadow = true;

        this.mesh.add(leftLeg, rightLeg);

        // Velocity target
        this.targetPos = new THREE.Vector3();

        // Position
        this.respawn();
        scene.add(this.mesh);

        // Add to players list
        players.push({ id: this.id, name: this.name, score: 0, isPlayer: false });
    }

    respawn() {
        this.health = 100;
        this.mesh.position.set(
            (Math.random() - 0.5) * (mapSize - 20),
            0.9,
            (Math.random() - 0.5) * (mapSize - 20)
        );
        this.getNewWanderTarget();
    }

    takeDamage(amt, sourceId) {
        this.health -= amt;
        this.state = 'attack';
        
        // Look for source (assume it's player for now)
        if (sourceId === player.id) this.target = { type: 'player', pos: yawObject.position };

        if (this.health <= 0) {
            // Die
            addKillFeed(player.name, this.name);
            if (sourceId === player.id) {
                player.score += 100;
                player.kills++;
                updatePlayerScore();
            }
            createHealthDrop(this.mesh.position.clone());
            this.respawn();
        }
    }

    getNewWanderTarget() {
        this.targetPos.set(
            this.mesh.position.x + (Math.random() - 0.5) * 30,
            0.9,
            this.mesh.position.z + (Math.random() - 0.5) * 30
        );
        // Clamp
        this.targetPos.x = Math.max(-mapSize/2+2, Math.min(mapSize/2-2, this.targetPos.x));
        this.targetPos.z = Math.max(-mapSize/2+2, Math.min(mapSize/2-2, this.targetPos.z));
    }

    update(dt) {
        // Simple AI logic
        const distToPlayer = this.mesh.position.distanceTo(yawObject.position);
        
        if (!player.isDead && distToPlayer < 25) {
            const dirToPlayer = yawObject.position.clone().sub(this.mesh.position).normalize();
            
            // Check 180-degree front Field of View
            const forward = new THREE.Vector3(0, 0, 1);
            forward.applyQuaternion(this.mesh.quaternion);
            const inFOV = forward.dot(dirToPlayer) > 0;
            
            let hasLOS = false;
            if (inFOV) {
                // Line of sight check
                const raycaster = new THREE.Raycaster(this.mesh.position, dirToPlayer);
                const intersects = raycaster.intersectObjects(scene.children, true);
                for(let hit of intersects) {
                    if(hit.object === this.mesh || hit.object.parent === this.mesh || (hit.object.parent && hit.object.parent.parent === this.mesh)) continue;
                    if(hit.object === yawObject || hit.distance > distToPlayer - 1) {
                        hasLOS = true;
                    }
                    break;
                }
            }

            if (hasLOS) {
                this.state = 'attack';
                this.target = yawObject.position;
            } else {
                this.state = 'wander';
            }
        } else {
            this.state = 'wander';
        }

        // Movement
        let moveSpeed = 5;
        let direction = new THREE.Vector3();

        if (this.state === 'wander') {
            if (this.mesh.position.distanceTo(this.targetPos) < 2) {
                this.getNewWanderTarget();
            } else {
                direction.subVectors(this.targetPos, this.mesh.position).normalize();
            }
        } else if (this.state === 'attack') {
            direction.subVectors(this.target, this.mesh.position);
            direction.y = 0;
            const dist = direction.length();
            direction.normalize();
            
            // Look at player
            const lookPos = new THREE.Vector3(this.target.x, this.mesh.position.y, this.target.z);
            this.mesh.lookAt(lookPos);

            // Strafe or stand still to shoot
            if (dist > 15) {
                moveSpeed = 8;
            } else if (dist < 5) {
                direction.negate(); // back away
                moveSpeed = 6;
            } else {
                moveSpeed = 0; // stop to shoot
            }

            // Shooting logic
            if (Date.now() - this.lastShot > 800) {
                // Add some inaccuracy
                const accuracy = 0.8;
                playSound('shoot', distToPlayer);
                if (Math.random() < accuracy) {
                    takeDamage(10, this.name);
                    
                    // Draw tracer from bot to player
                    const p1 = this.mesh.position.clone();
                    p1.y += 0.5; // From gun height
                    const p2 = yawObject.position.clone();
                    const geo = new THREE.BufferGeometry().setFromPoints([p1, p2]);
                    const mat = new THREE.LineBasicMaterial({ color: 0xff2d55 });
                    const tracer = new THREE.Line(geo, mat);
                    scene.add(tracer);
                    setTimeout(() => { scene.remove(tracer); geo.dispose(); mat.dispose(); }, 50);
                }
                this.lastShot = Date.now() + Math.random() * 500;
            }
        }

        if (moveSpeed > 0) {
            const oldPos = this.mesh.position.clone();
            this.mesh.position.x += direction.x * moveSpeed * dt;
            this.mesh.position.z += direction.z * moveSpeed * dt;
            
            // Look direction if wandering
            if (this.state === 'wander') {
                const lookPos = this.mesh.position.clone().add(direction);
                this.mesh.lookAt(lookPos);
            }

            if (checkCollision(this.mesh.position, 0.6)) {
                this.mesh.position.copy(oldPos);
                this.getNewWanderTarget();
            }
        }
    }
}

function getBotFromMesh(mesh) {
    if (!mesh) return null;
    if (mesh.userData.bot) return mesh.userData.bot;
    if (mesh.parent && mesh.parent.userData && mesh.parent.userData.bot) return mesh.parent.userData.bot;
    if (mesh.parent && mesh.parent.parent && mesh.parent.parent.userData && mesh.parent.parent.userData.bot) return mesh.parent.parent.userData.bot;
    return null;
}

function spawnBots(count) {
    // Clear existing
    bots.forEach(b => scene.remove(b.mesh));
    bots = [];
    players = players.filter(p => p.isPlayer);

    for (let i = 0; i < count; i++) {
        bots.push(new Bot(i));
    }
}

function updateBots(dt) {
    bots.forEach(bot => bot.update(dt));
}

function createHealthDrop(pos) {
    const geo = new THREE.BoxGeometry(0.8, 0.8, 0.8);
    const mat = new THREE.MeshStandardMaterial({ color: 0x00ff00, emissive: 0x005500 });
    const mesh = new THREE.Mesh(geo, mat);
    
    // Position it hovering slightly
    mesh.position.copy(pos);
    mesh.position.y = 0.5;
    
    // Add point light for glow effect
    const light = new THREE.PointLight(0x00ff00, 1.5, 5);
    mesh.add(light);
    
    scene.add(mesh);
    healthDrops.push({ mesh: mesh, active: true });
}

function updateHealthDrops(dt) {
    for (let i = healthDrops.length - 1; i >= 0; i--) {
        const drop = healthDrops[i];
        if (!drop.active) continue;
        
        // Spin the drop
        drop.mesh.rotation.y += dt * 2;
        drop.mesh.rotation.x += dt;
        
        // Collision check with player
        if (!player.isDead && player.health < 100) {
            // Using horizontal distance so height doesn't mess it up as much
            const dist = new THREE.Vector2(drop.mesh.position.x, drop.mesh.position.z).distanceTo(new THREE.Vector2(yawObject.position.x, yawObject.position.z));
            if (dist < 2.0) {
                // Picked up
                playSound('heal', 0);
                player.health = Math.min(100, player.health + 20);
                updateHUD();
                
                // Show heal screen flash
                const overlay = document.getElementById('damageOverlay');
                const origBorder = overlay.style.borderColor;
                const origBg = overlay.style.backgroundColor;
                
                overlay.style.borderColor = 'rgba(0, 255, 0, 0.6)';
                overlay.style.backgroundColor = 'rgba(0, 255, 0, 0.15)';
                setTimeout(() => {
                    overlay.style.borderColor = origBorder || 'transparent';
                    overlay.style.backgroundColor = origBg || 'transparent';
                }, 300);

                // Remove from scene and memory
                scene.remove(drop.mesh);
                drop.mesh.geometry.dispose();
                drop.mesh.material.dispose();
                healthDrops.splice(i, 1);
            }
        }
    }
}

function announceUI(msg) {
    const el = document.getElementById('uiAnnouncement');
    if (!el) return;
    el.textContent = msg;
    el.style.opacity = 1;
    if (uiTimeout) clearTimeout(uiTimeout);
    uiTimeout = setTimeout(() => { el.style.opacity = 0; }, 3000);
}

function spawnDrop() {
    const types = ['shotgun', 'sniper', 'ar', 'ammo', 'shield', 'damage'];
    const type = types[Math.floor(Math.random() * types.length)];
    const isPowerup = type === 'shield' || type === 'damage';
    
    const mesh = createItemMesh(type);
    
    const pos = new THREE.Vector3(
        (Math.random() - 0.5) * (mapSize - 30),
        0.5,
        (Math.random() - 0.5) * (mapSize - 30)
    );
    mesh.position.copy(pos);
    
    scene.add(mesh);
    weaponDrops.push({ mesh: mesh, type: type, active: true, spawnTime: Date.now(), isPowerup: isPowerup });
    
    if(!isPowerup) announceUI((type === 'ammo' ? 'AMMO' : WEAPONS[type].name) + ' DROPPED!');
}

function updateDrops(dt) {
    const now = Date.now();
    for (let i = weaponDrops.length - 1; i >= 0; i--) {
        const drop = weaponDrops[i];
        if (!drop.active) continue;
        
        drop.mesh.rotation.y += dt;
        
        if (now - drop.spawnTime > 15000) {
            scene.remove(drop.mesh);
            // Instead of recursing children to dispose geometry gracefully, we lean on THREE gc here since it's transient
            weaponDrops.splice(i, 1);
            if(!drop.isPowerup) announceUI('DROP VANISHED!');
            continue;
        }
        
        if (!player.isDead) {
            const dist = new THREE.Vector2(drop.mesh.position.x, drop.mesh.position.z).distanceTo(new THREE.Vector2(yawObject.position.x, yawObject.position.z));
            if (dist < 2.0) {
                playSound('heal', 0);
                if (drop.type === 'ammo') {
                    const w = WEAPONS[player.currentWeapon];
                    player.reserveAmmo += w.max * 2;
                    announceUI('PICKED UP AMMO');
                } else if (drop.type === 'shield') {
                    player.shieldTimer = Date.now() + 5000;
                    announceUI('SHIELD ACTIVATED! (5s)');
                } else if (drop.type === 'damage') {
                    player.damageTimer = Date.now() + 5000;
                    announceUI('DOUBLE DAMAGE! (5s)');
                } else {
                    player.currentWeapon = drop.type;
                    const w = WEAPONS[drop.type];
                    player.maxAmmo = w.max;
                    player.ammo = w.max;
                    player.reserveAmmo = w.reserve;
                    document.getElementById('weaponName').textContent = w.name;
                    updatePlayerGun(drop.type);
                    announceUI('PICKED UP ' + w.name);
                }
                updateHUD();
                
                scene.remove(drop.mesh);
                weaponDrops.splice(i, 1);
            }
        }
    }
    
    if (now > nextDropTime) {
        spawnDrop();
        nextDropTime = now + 15000 + Math.random() * 10000;
    }
}

// --- UI & HUD ---
function updateHUD() {
    document.getElementById('healthText').textContent = player.health;
    const hFill = document.getElementById('healthFill');
    hFill.style.width = player.health + '%';
    
    hFill.className = 'health-fill';
    if (player.health < 40) hFill.classList.add('low');
    else if (player.health < 70) hFill.classList.add('medium');

    document.getElementById('ammoCurrent').textContent = player.ammo;
    document.getElementById('ammoReserve').textContent = player.reserveAmmo;
    
    document.getElementById('scoreValue').textContent = player.score;
}

function updatePlayerScore() {
    document.getElementById('scoreValue').textContent = player.score;
    const pData = players.find(p => p.isPlayer);
    if(pData) pData.score = player.score;
    updateLeaderboard();
}

function addKillFeed(killer, victim) {
    const feed = document.getElementById('killFeed');
    const el = document.createElement('div');
    el.className = 'kill-entry';
    el.innerHTML = `<span class="killer">${killer}</span> <span class="weapon-icon">🔫</span> <span class="victim">${victim}</span>`;
    feed.appendChild(el);
    setTimeout(() => {
        el.style.opacity = '0';
        setTimeout(() => el.remove(), 300);
    }, 4000);
}

function updateLeaderboard() {
    // Sort players by score
    const sorted = [...players].sort((a, b) => b.score - a.score).slice(0, 5);
    
    const container = document.getElementById('lbEntries');
    container.innerHTML = '';
    
    sorted.forEach((p, idx) => {
        const el = document.createElement('div');
        el.className = 'lb-entry';
        
        let rankClass = '';
        if (idx === 0) rankClass = 'gold';
        else if (idx === 1) rankClass = 'silver';
        else if (idx === 2) rankClass = 'bronze';
        
        el.innerHTML = `
            <div class="lb-rank ${rankClass}">#${idx+1}</div>
            <div class="lb-name ${p.isPlayer ? 'is-player' : ''}">${p.name}</div>
            <div class="lb-score">${p.score}</div>
        `;
        container.appendChild(el);
    });
}

function drawMinimap() {
    const canvas = document.getElementById('minimap');
    if (!canvas || !isPlaying || player.isDead) return;
    const ctx = canvas.getContext('2d');
    
    const w = canvas.width;
    const h = canvas.height;
    
    // Clear
    ctx.clearRect(0, 0, w, h);
    
    // Config
    const scale = w / mapSize;
    const cx = w / 2;
    const cy = h / 2;

    // Draw borders
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.3)';
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, w, h);

    // Draw obstacles (simplistic)
    ctx.fillStyle = 'rgba(122, 139, 168, 0.3)';
    obstacles.forEach(ob => {
        const mx = cx + (ob.min.x) * scale;
        const my = cy + (ob.min.z) * scale;
        const width = (ob.max.x - ob.min.x) * scale;
        const height = (ob.max.z - ob.min.z) * scale;
        ctx.fillRect(mx, my, width, height);
    });

    // Draw Drops (Skip powerups)
    weaponDrops.forEach(drop => {
        if (!drop.active || drop.isPowerup) return;
        const dx = cx + drop.mesh.position.x * scale;
        const dy = cy + drop.mesh.position.z * scale;
        ctx.fillStyle = drop.type === 'ammo' ? '#00aaff' : '#ffaa00';
        ctx.beginPath();
        ctx.arc(dx, dy, 2, 0, Math.PI * 2);
        ctx.fill();
    });

    // Draw bots
    ctx.fillStyle = '#ff2d55';
    bots.forEach(bot => {
        const bx = cx + bot.mesh.position.x * scale;
        const by = cy + bot.mesh.position.z * scale;
        ctx.beginPath();
        ctx.arc(bx, by, 3, 0, Math.PI * 2);
        ctx.fill();
    });

    // Draw Player
    const px = cx + yawObject.position.x * scale;
    const pz = cy + yawObject.position.z * scale;
    
    // Field of view cone
    ctx.fillStyle = 'rgba(0, 240, 255, 0.2)';
    ctx.beginPath();
    ctx.moveTo(px, pz);
    // Note: yawObject rot Y is reversed for map
    const angle = -yawObject.rotation.y - Math.PI/2; 
    ctx.arc(px, pz, 30, angle - 0.5, angle + 0.5);
    ctx.fill();

    // Player dot
    ctx.fillStyle = '#00f0ff';
    ctx.beginPath();
    ctx.arc(px, pz, 4, 0, Math.PI * 2);
    ctx.fill();
    
    // Player outline
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    ctx.stroke();
}

// --- Main Loop ---
function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
    requestAnimationFrame(animate);

    const delta = clock.getDelta();

    if (isPlaying) {
        updatePlayer(delta);
        if (player.isAutoShooting) shoot();
        updateBots(delta);
        updateHealthDrops(delta);
        updateDrops(delta);
        drawMinimap();
    } else {
        if (menuBotMesh && menuBotMesh.visible) {
            menuBotMesh.rotation.y += delta * menuBotMesh.userData.rotSpeed;
            menuBotMesh.position.y = menuBotMesh.userData.baseY + Math.sin(Date.now() * 0.0015) * 0.4;
        }
    }

    renderer.render(scene, camera);
}

// Start everything
window.onload = init;
