// Formes 3D du décor « Circuit imprimé » (vue en relief, voir rendu3d.js) : la carte mère vue de
// près. Le sol reste celui du rendu 2D (carte verte, zones sérigraphiées, pistes de cuivre, vias,
// empreinte du socket) ; s'y dressent les composants soudés (puces à pattes, puces étroites,
// condensateurs), leurs résistances (processus) et leur LED, la puce du processeur avec ses broches
// dorées et le cadre de la mémoire, les barrettes des disques debout dans leur connecteur et le port
// RJ45 d'Internet. Les petites pièces nombreuses (pattes, pastilles, contacts) sont des instances
// d'une même boîte unité : une seule maille, un seul ordre de dessin par volume.

import { CPU } from './modele.js';
import { cleCible } from './trafic.js';

const ROUGE = '#FF4D5E';          // le rouge du circuit (alerte, saturation), comme en 2D
const ETAIN = '#C9CED3';          // pattes étamées des composants
const OR = '#D9B45F';             // broches du processeur
const OR_CONTACT = '#E2B652';     // contacts des barrettes et du port
const PALIERS_MAX_RESISTANCES = 6;

export const ciel = p => p.table;

export function cleApplication(lot, c) {
  const d = lot.app.donnees;
  return [d.etat, d.alerte ? 1 : 0, Math.round(lot.taille * 2), lot.forme, lot.quartier.couleur,
    nbResistances(d), c.nuitArrondie].join('|');
}

const nbResistances = d => Math.min(PALIERS_MAX_RESISTANCES, Math.max(0, (d.nb_processus ?? 1) - 1));

// ---------- Outils ----------

// Couleur sans transparence (les palettes interpolées sont en rgba(), que three.js n'aime pas).
const css = (c, couleur) => c.melanger(couleur, couleur, 0);

// Petites pièces : une maille instanciée d'une boîte unité posée au sol. Chaque pièce est
// [x, y (base), z, largeur, hauteur, profondeur, couleur, angle autour de la verticale].
function pieces(c, liste, { ombre = true } = {}) {
  const { THREE } = c;
  if (!liste.length) return null;
  const geo = new THREE.BoxGeometry(1, 1, 1);
  geo.translate(0, 0.5, 0);
  const maille = instances(c, geo, c.materiau('#FFFFFF'), liste.length);
  const matrice = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const axe = new THREE.Vector3(0, 1, 0);
  const pos = new THREE.Vector3();
  const taille = new THREE.Vector3();
  const couleur = new THREE.Color();
  liste.forEach(([x, y, z, l, h, p, teinte, angle = 0], i) => {
    q.setFromAxisAngle(axe, angle);
    matrice.compose(pos.set(x, y, z), q, taille.set(l, h, p));
    maille.setMatrixAt(i, matrice);
    maille.setColorAt(i, couleur.set(css(c, teinte)));
  });
  maille.castShadow = ombre;
  maille.receiveShadow = true;
  return maille;
}

// Maille instanciée dont les tampons d'instances sont libérés avec sa géométrie (rendu3d.js ne
// libère que géométries et matériaux quand un volume est reconstruit).
function instances(c, geo, materiau, nombre) {
  const maille = new c.THREE.InstancedMesh(geo, materiau, nombre);
  geo.addEventListener('dispose', () => maille.dispose());
  return maille;
}

// Lueur douce (dégradé radial blanc), partagée par les LED, le processeur et le port.
let texteLueur = null;
function lueur(c) {
  if (!texteLueur) {
    const toile = document.createElement('canvas');
    toile.width = toile.height = 128;
    const ctx = toile.getContext('2d');
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    texteLueur = new c.THREE.CanvasTexture(toile);
  }
  return texteLueur;
}

// Plaque de lumière posée à plat (ou debout si debout = true), qui s'ajoute à ce qu'elle recouvre.
function plaqueLumineuse(c, l, h, couleur, { texture = true, debout = false } = {}) {
  const { THREE } = c;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(l, h), new THREE.MeshBasicMaterial({
    color: css(c, couleur), map: texture ? lueur(c) : null, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  }));
  if (!debout) m.rotation.x = -Math.PI / 2;
  m.renderOrder = 2;
  return m;
}

// Cadre rectangulaire de quatre barres (bords x0..x1, z0..z1), partageant un matériau.
function cadre(c, x0, z0, x1, z1, epaisseur, hauteur, materiau, y = 0) {
  const { THREE } = c;
  const groupe = new THREE.Group();
  const barre = (l, p, x, z) => {
    const geo = new THREE.BoxGeometry(l, hauteur, p);
    geo.translate(0, hauteur / 2, 0);
    const m = new THREE.Mesh(geo, materiau);
    m.position.set(x, y, z);
    groupe.add(m);
  };
  const [lx, lz] = [x1 - x0, z1 - z0];
  barre(lx + epaisseur, epaisseur, (x0 + x1) / 2, z0);
  barre(lx + epaisseur, epaisseur, (x0 + x1) / 2, z1);
  barre(epaisseur, lz - epaisseur, x0, (z0 + z1) / 2);
  barre(epaisseur, lz - epaisseur, x1, (z0 + z1) / 2);
  return groupe;
}

// Embouteillage : le bus qui mène à la cible saturée chauffe en rouge (bande large qui pulse et
// trait vif au milieu), comme les pistes chaudes du 2D. Coordonnées relatives à l'origine (ox, oy).
function pistesChaudes(c, cle, yBus, xCible, yCible, ox, oy) {
  const { THREE } = c;
  const zones = c.ville.zones ?? [];
  const groupe = new THREE.Group();
  if (!zones.length) return groupe;
  const xMin = Math.min(...zones.map(q => q.collecteur)) - 8;
  const xMax = Math.max(...zones.map(q => q.collecteur)) + 8;
  const halo = new THREE.MeshBasicMaterial({ color: css(c, ROUGE), transparent: true, opacity: 0, depthWrite: false });
  const vif = new THREE.MeshBasicMaterial({ color: '#FF7A5C', transparent: true, opacity: 0, depthWrite: false });
  const bande = (x0, z0, x1, z1, largeur, materiau, y) => {
    const [l, p] = [Math.abs(x1 - x0) + largeur, Math.abs(z1 - z0) + largeur];
    const m = new THREE.Mesh(new THREE.PlaneGeometry(l, p), materiau);
    m.rotation.x = -Math.PI / 2;
    m.position.set((x0 + x1) / 2 - ox, y, (z0 + z1) / 2 - oy);
    m.renderOrder = 1;
    groupe.add(m);
  };
  for (const [largeur, materiau, y] of [[22, halo, 0.35], [4, vif, 0.45]]) {
    bande(xMin, yBus, xMax, yBus, largeur, materiau, y);
    bande(xCible, yBus, xCible, yCible, largeur, materiau, y);
  }
  groupe.visible = false;
  groupe.userData.maj = (temps, ctx) => {
    const saturation = ctx.trafic.saturation.get(cle) ?? 0;
    groupe.visible = saturation > 0;
    if (!groupe.visible) return;
    halo.opacity = (0.32 + 0.18 * Math.sin(temps / 260)) * (0.5 + 0.5 * saturation);
    vif.opacity = 0.9;
  };
  return groupe;
}

// Zone rouge qui pulse sous une barrette ou le port saturé.
function haloSaturation(c, l, h, cle) {
  const { THREE } = c;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(l + 36, h + 36),
    new THREE.MeshBasicMaterial({ color: css(c, ROUGE), transparent: true, opacity: 0, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.3;
  m.renderOrder = 1;
  m.userData.maj = (temps, ctx) => {
    const saturation = ctx.trafic.saturation.get(cle) ?? 0;
    m.visible = saturation > 0;
    m.material.opacity = 0.2 + 0.3 * saturation * (0.5 + 0.5 * Math.sin(temps / 250));
  };
  return m;
}

// ---------- Composants (applications) ----------

// Un composant par application, soudé sur son empreinte : puce carrée à pattes sur les quatre
// côtés, puce étroite à deux rangées de pattes, ou condensateur cylindrique. Sa taille suit la
// mémoire, sa LED le processeur. Fermé : il ne reste que l'empreinte en pointillés et ses pastilles.
export function application(lot, c) {
  const { THREE } = c;
  const p = c.palette;
  const app = lot.app;
  const d = app.donnees;
  const q = lot.quartier;
  const ferme = d.etat === 'ferme';
  const veille = d.etat === 'veille';
  const t = lot.taille;
  const part = Math.max(0, Math.min(1, (t - 9) / 12));
  const condensateur = lot.forme === 'condensateur';
  const [dl, dh] = lot.forme === 'etroite' ? [t * 1.2, t * 0.75] : [t, t];
  const r = t * 0.85;
  // En veille, le composant est à demi effacé (comme l'opacité de moitié en 2D).
  const estompe = couleur => (veille ? c.melanger(couleur, p.carte, 0.5) : couleur);
  const groupe = new THREE.Group();
  const liste = [];

  // Pastilles de soudure (et pattes étamées si le composant est là)
  const pastille = ferme ? c.melanger(p.pastille, p.carte, 0.55) : estompe(p.pastille);
  const patte = estompe(ETAIN);
  if (condensateur) {
    for (const s of [-1, 1]) {
      liste.push([s * (r + 1), 0, 0, 4.4, 0.5, 4.4, pastille]);
      if (!ferme) liste.push([s * (r + 0.6), 0.5, 0, 2.4, 1.2, 1.4, patte]);
    }
  } else {
    const n = Math.max(3, Math.round(dl / 4));
    for (let i = 0; i < n; i++) {
      const x = -dl + 3 + (i * (2 * dl - 6)) / Math.max(1, n - 1);
      for (const s of [-1, 1]) {
        liste.push([x, 0, s * (dh + 1.5), 2.4, 0.5, 3.4, pastille]);
        if (!ferme) liste.push([x, 0.5, s * (dh + 0.6), 1.4, 1.1, 3.6, patte]);
      }
    }
    if (lot.forme === 'puce') {
      for (let i = 0; i < n; i++) {
        const z = -dh + 3 + (i * (2 * dh - 6)) / Math.max(1, n - 1);
        for (const s of [-1, 1]) {
          liste.push([s * (dl + 1.5), 0, z, 3.4, 0.5, 2.4, pastille]);
          if (!ferme) liste.push([s * (dl + 0.6), 0.5, z, 3.6, 1.1, 1.4, patte]);
        }
      }
    }
  }

  if (ferme) {
    // Empreinte vide : contour en pointillés sérigraphié, et « NC » (non connecté) au milieu
    if (condensateur) {
      const nb = Math.max(10, Math.round((2 * Math.PI * r) / 6));
      for (let i = 0; i < nb; i++) {
        const a = (i / nb) * Math.PI * 2;
        liste.push([Math.cos(a) * r, 0, Math.sin(a) * r, 3, 0.35, 1.2, p.ferme, -a + Math.PI / 2]);
      }
    } else {
      for (let x = -dl; x < dl - 1; x += 6) {
        const l = Math.min(3, dl - x);
        liste.push([x + l / 2, 0, -dh, l, 0.35, 1.2, p.ferme], [x + l / 2, 0, dh, l, 0.35, 1.2, p.ferme]);
      }
      for (let z = -dh; z < dh - 1; z += 6) {
        const l = Math.min(3, dh - z);
        liste.push([-dl, 0, z + l / 2, 1.2, 0.35, l, p.ferme], [dl, 0, z + l / 2, 1.2, 0.35, l, p.ferme]);
      }
    }
    groupe.add(pieces(c, liste, { ombre: false }));
    const nc = c.texteSur('NC', 12, 6, { fond: 'rgba(0,0,0,0)', couleur: css(c, p.ferme), gras: 700 });
    nc.material.transparent = true;
    nc.material.depthWrite = false;
    nc.rotation.x = -Math.PI / 2;
    nc.position.y = 0.4;
    groupe.add(nc);
    groupe.userData.hauteur = 4;
    return groupe;
  }

  // Corps du composant
  let haut;
  if (condensateur) {
    haut = 8 + 20 * part;
    groupe.add(c.cylindre(r, haut, estompe('#B8C0C7'), { faces: 28 }));
    // Capot d'aluminium et évent en croix sur le dessus
    const capot = c.cylindre(r * 0.96, 0.5, estompe('#E4E8EB'), { faces: 28, ombre: false });
    capot.position.y = haut;
    groupe.add(capot);
    liste.push([0, haut + 0.5, 0, r * 0.9, 0.3, 0.9, '#4A5056'], [0, haut + 0.5, 0, 0.9, 0.3, r * 0.9, '#4A5056']);
    // Manchon de la couleur du quartier, côté polarité (à l'ouest, comme en 2D)
    const geo = new THREE.CylinderGeometry(r * 1.03, r * 1.03, haut * 0.92, 20, 1, true, Math.PI * 1.15, Math.PI * 0.7);
    geo.translate(0, haut * 0.46, 0);
    const manchon = new THREE.Mesh(geo, c.materiau(estompe(q.couleur)));
    manchon.castShadow = true;
    groupe.add(manchon);
  } else {
    const leve = 0.8;   // le boîtier repose sur ses pattes
    haut = (lot.forme === 'puce' ? 2.5 + 6 * part : 2 + 4.5 * part);
    const corps = c.boite(2 * dl, haut, 2 * dh, estompe(c.eclaircir(p.corps, 0.12)));
    corps.position.y = leve;
    groupe.add(corps);
    haut += leve;
    // Liseré de la couleur du quartier sur le dessus, et point du repère de la patte 1
    const liser = estompe(q.couleur);
    const [ix, iz] = [dl - 2.5, dh - 2.5];
    liste.push(
      [0, haut, -iz, 2 * ix + 1.4, 0.3, 1.4, liser], [0, haut, iz, 2 * ix + 1.4, 0.3, 1.4, liser],
      [-ix, haut, 0, 1.4, 0.3, 2 * iz - 1.4, liser], [ix, haut, 0, 1.4, 0.3, 2 * iz - 1.4, liser],
      [-dl + 5, haut, -dh + 5, 2.2, 0.3, 2.2, estompe('#9AA0A6')],
    );
  }

  // Processus : petites résistances en rang sous le composant
  const nb = nbResistances(d);
  const zRes = lot.y + lot.h - 2 - lot.cy;
  for (let i = 0; i < nb; i++) {
    const x = (i - (nb - 1) / 2) * 7.5;
    liste.push([x, 0, zRes, 5.2, 1.8, 2.8, estompe('#D9C9A3')], [x, 0, zRes, 1.2, 1.9, 2.9, estompe('#8A5A2B')]);
    liste.push([x - 2.4, 0, zRes, 1.2, 1.2, 3, estompe(ETAIN)], [x + 2.4, 0, zRes, 1.2, 1.2, 3, estompe(ETAIN)]);
  }
  groupe.add(pieces(c, liste));

  // LED au coin de l'empreinte, et sa lueur sur la carte
  const [xLed, zLed] = [lot.x + lot.l - 3 - lot.cx, lot.y + 3 - lot.cy];
  const led = c.boite(4.4, 1.8, 3.2, p.eteinte, { lumineux: true, ombre: false });
  led.position.set(xLed, 0, zLed);
  const halo = plaqueLumineuse(c, 1, 1, '#FFFFFF');
  halo.position.set(xLed, 0.6, zLed);
  groupe.add(led, halo);

  // Alerte : cadre rouge qui pulse autour de l'empreinte, et l'épingle au-dessus
  let cadreAlerte = null;
  if (d.alerte) {
    cadreAlerte = c.materiau(ROUGE, { lumineux: true });
    groupe.add(cadre(c, lot.x - 1 - lot.cx, lot.y - 1 - lot.cy, lot.x + lot.l + 1 - lot.cx, lot.y + lot.h + 1 - lot.cy, 1.6, 0.6, cadreAlerte));
    groupe.add(c.epingle(haut + 10));
  }

  groupe.userData.hauteur = haut;
  groupe.userData.maj = (temps, ctx) => {
    const donnees = app.donnees;
    const cpu = Math.min(1, donnees.cpu / 25);
    let couleur = null;
    let force = 0;
    if (donnees.alerte) {
      if (Math.sin(temps / 160) > -0.2) { couleur = ROUGE; force = 1; }
    } else if (donnees.etat !== 'veille' && cpu > 0.02) {
      couleur = ctx.eclaircir(q.couleur, 0.3);
      force = 0.35 + 0.65 * cpu;
    }
    led.material.color.set(couleur ? ctx.eclaircir(couleur, 0.4 * force) : css(ctx, ctx.palette.eteinte));
    led.material.emissive.set(couleur ?? '#000000');
    led.material.emissiveIntensity = couleur ? 0.6 + 0.6 * force : 0;
    halo.visible = !!couleur;
    if (couleur) {
      const rayon = 5 + 7 * force * (1 + 0.4 * ctx.nuit);
      halo.scale.set(2 * rayon, 2 * rayon, 1);
      halo.material.color.set(couleur);
      halo.material.opacity = 0.55 * force + 0.15;
    }
    if (cadreAlerte) cadreAlerte.emissiveIntensity = 0.5 + 0.4 * Math.sin(temps / 180);
  };
  return groupe;
}

// ---------- Processeur et mémoire ----------

// La grosse puce au centre : boîtier vert sombre sur ses broches dorées, capot métallique qui rougit
// avec la charge, lueur orange autour quand le processeur travaille. Autour, le cadre de la mémoire
// se remplit depuis le milieu du haut, dans le sens des aiguilles d'une montre (rouge au-delà de 90 %).
export function tour(t, c) {
  const { THREE } = c;
  const p = c.palette;
  const R = t.rayon ?? CPU;
  const groupe = new THREE.Group();

  // Broches dorées sur les quatre côtés
  const broches = [];
  const n = 16;
  for (let i = 0; i < n; i++) {
    const u = -R + 12 + (i * (2 * R - 24)) / (n - 1);
    broches.push([u, 0, -R - 4.5, 4, 1.4, 9, OR], [u, 0, R + 4.5, 4, 1.4, 9, OR],
      [-R - 4.5, 0, u, 9, 1.4, 4, OR], [R + 4.5, 0, u, 9, 1.4, 4, OR]);
  }
  // Repère de la broche 1 (triangle blanc du coin nord-ouest, ici un petit carré tourné)
  broches.push([-R + 9, 6, -R + 9, 6, 0.4, 6, '#E8ECEF', Math.PI / 4]);
  groupe.add(pieces(c, broches));

  // Boîtier et capot
  groupe.add(c.boite(2 * R, 6, 2 * R, '#1C3A2A'));
  const capot = c.boite(2 * R - 20, 4, 2 * R - 20, p.puce, { propre: true });
  capot.position.y = 6;
  groupe.add(capot);
  const coeurs = c.ville.systeme?.nb_coeurs;
  if (coeurs) {
    const inscription = c.texteSur(`${coeurs} CŒURS`, 70, 10, { fond: 'rgba(0,0,0,0)', couleur: 'rgba(32,39,44,0.75)', gras: 700 });
    inscription.material.transparent = true;
    inscription.material.depthWrite = false;
    inscription.rotation.x = -Math.PI / 2;
    inscription.position.set(0, 10.5, -R * 0.5);
    groupe.add(inscription);
  }

  // Lueur orange sous la puce
  const chaleur = plaqueLumineuse(c, 1, 1, '#FF9A3C');
  chaleur.position.y = 0.3;
  groupe.add(chaleur);

  // Cadre de la mémoire : fond pâle et progression (au plus cinq barres le long du pourtour)
  const rr = R + 18;
  groupe.add(cadre(c, -rr, -rr, rr, rr, 5, 1, c.materiau('#FFFFFF', { transparent: true, opacite: 0.14 }), 0.3));
  const geo = new THREE.BoxGeometry(1, 1, 1);
  geo.translate(0, 0.5, 0);
  const progression = instances(c, geo, c.materiau(p.ram, { lumineux: true }), 5);
  progression.frustumCulled = false;
  progression.count = 0;
  progression.position.y = 0.4;
  groupe.add(progression);
  const matrice = new THREE.Matrix4();
  const tourCadre = [[0, -rr], [rr, -rr], [rr, rr], [-rr, rr], [-rr, -rr], [0, -rr]];
  let cle = '';

  groupe.userData.hauteur = 12;
  groupe.userData.maj = (temps, ctx) => {
    const s = ctx.ville.systeme;
    if (!s) return;
    const cpu = Math.max(0, Math.min(1, s.cpu / 100));
    const ram = Math.max(0.01, Math.min(1, s.ram_utilisee / s.ram_totale));
    const puce = css(ctx, ctx.palette.puce);
    capot.material.color.set(cpu > 0.5 ? ctx.melanger(puce, ROUGE, (cpu - 0.5) * 0.5) : puce);
    chaleur.visible = cpu > 0.05;
    const taille = 2 * R * (1.6 + 0.6 * cpu);
    chaleur.scale.set(taille, taille, 1);
    chaleur.material.opacity = 0.15 + 0.35 * cpu * (0.85 + 0.15 * Math.sin(temps / 300));
    progression.material.color.set(ram > 0.9 ? ROUGE : css(ctx, ctx.palette.ram));
    progression.material.emissive.copy(progression.material.color);
    progression.material.emissiveIntensity = 0.35 + 0.4 * ctx.nuit;
    const nouvelle = String(Math.round(ram * 200));
    if (nouvelle === cle) return;
    cle = nouvelle;
    let reste = ram * 8 * rr;
    let k = 0;
    for (let i = 1; i < tourCadre.length && reste > 0; i++) {
      const [a, b] = [tourCadre[i - 1], tourCadre[i]];
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const f = Math.min(1, reste / l);
      const [fx, fz] = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
      const long = Math.hypot(fx - a[0], fz - a[1]) + 5;
      const horizontale = a[1] === b[1];
      matrice.makeScale(horizontale ? long : 5, 1.4, horizontale ? 5 : long);
      matrice.setPosition((a[0] + fx) / 2, 0, (a[1] + fz) / 2);
      progression.setMatrixAt(k++, matrice);
      reste -= l;
    }
    progression.count = k;
    progression.instanceMatrix.needsUpdate = true;
  };
  return groupe;
}

// ---------- Disques : barrettes ----------

// Une barrette debout dans son connecteur : circuit vert, puces noires et contacts dorés sur les
// deux faces, étiquette au nom du disque avec sa jauge de remplissage (rouge au-delà de 90 %).
export function entrepot(e, c) {
  const { THREE } = c;
  const d = e.disque;
  const groupe = new THREE.Group();
  const cle = cleCible({ type: 'entrepot', entrepot: e });
  const [l, h] = [e.l ?? 200, e.h ?? 84];
  groupe.add(haloSaturation(c, l, h, cle));
  groupe.add(pistesChaudes(c, cle, c.ville.busBas, e.cx, e.y, e.cx, e.cy));

  // Connecteur noir et ses deux loquets
  groupe.add(c.boite(l + 12, 9, 14, '#2A2D30'));
  for (const s of [-1, 1]) {
    const loquet = c.boite(5, 16, 12, '#E9E6DC');
    loquet.position.x = s * (l / 2 + 8);
    groupe.add(loquet);
  }

  // Le circuit de la barrette
  const HAUT = 60;
  const EP = 2.6;
  const plaque = c.boite(l, HAUT, EP, '#145A33');
  plaque.position.y = 5;
  groupe.add(plaque);
  const details = [];
  const largeurPuce = (l - 16 - 3 * 8) / 4;
  for (const s of [-1, 1]) {
    for (let x = -l / 2 + 6; x < l / 2 - 6; x += 5) details.push([x + 1.5, 9, s * (EP / 2 + 0.15), 3, 7, 0.3, OR_CONTACT]);
    for (let i = 0; i < 4; i++) details.push([-l / 2 + 8 + i * (largeurPuce + 8) + largeurPuce / 2, HAUT - 18, s * (EP / 2 + 0.8), largeurPuce, 16, 1.6, '#16181A']);
  }
  groupe.add(pieces(c, details));

  // Étiquettes (une par face) : nom du disque et jauge
  const jauges = [];
  const longueurJauge = l - 80;
  for (const s of [1, -1]) {
    const face = new THREE.Group();
    face.rotation.y = s > 0 ? 0 : Math.PI;
    face.position.z = s * (EP / 2);
    const fond = c.boite(l - 16, 20, 0.4, '#F3F4EE', { ombre: false });
    fond.position.y = 18;
    const nom = c.texteSur(d.nom, 44, 16, { fond: '#F3F4EE', couleur: '#20272C' });
    nom.position.set(-l / 2 + 8 + 24, 28, 0.45);
    const vide = c.boite(longueurJauge, 6, 0.3, '#D5D7D0', { ombre: false });
    vide.position.set(-l / 2 + 62 + longueurJauge / 2, 25, 0.4);
    const geoJauge = new THREE.BoxGeometry(1, 6, 0.4);
    geoJauge.translate(0.5, 3, 0);
    const plein = new THREE.Mesh(geoJauge, c.materiau(e.toit ?? '#5CC8FF', { propre: true }));
    plein.position.set(-l / 2 + 62, 25, 0.5);
    jauges.push(plein);
    face.add(fond, nom, vide, plein);
    groupe.add(face);
  }
  groupe.userData.maj = () => {
    const disque = e.disque;
    const rempli = Math.max(0.01, Math.min(1, disque.utilise / Math.max(1, disque.total)));
    for (const j of jauges) {
      j.scale.x = longueurJauge * rempli;
      j.material.color.set(rempli > 0.9 ? ROUGE : (e.toit ?? '#5CC8FF'));
    }
  };
  groupe.userData.hauteur = HAUT + 5;
  return groupe;
}

// ---------- Internet : port RJ45 ----------

// Boîtier métallique, ouverture de la prise et ses contacts dorés sur la face avant (tournée vers
// la puce), LED verte qui clignote avec l'activité réseau (rouge si saturé) et LED orange fixe
// quand des données passent.
export function internet(a, c) {
  const { THREE } = c;
  const groupe = new THREE.Group();
  const [l, h] = [a.l ?? 128, a.h ?? 96];
  const HAUT = 46;
  groupe.add(haloSaturation(c, l, h, 'aeroport'));
  groupe.add(pistesChaudes(c, 'aeroport', c.ville.busHaut, a.cx, a.y + a.h, a.cx, a.cy));

  groupe.add(c.boite(l + 6, 3, h + 6, '#8F979E'));
  groupe.add(c.boite(l, HAUT, h, '#BCC3C9'));
  const avant = h / 2;
  const details = [
    // Ouverture (avec l'encoche du clip en bas) et ses huit contacts
    [0, 14, avant, 76, 26, 1.2, '#15181B'],
    [0, 6, avant, 24, 8, 1.2, '#15181B'],
    // Pattes de masse du blindage
    [-l / 2 - 1, 0, 0, 2, 10, 14, '#A8AFB5'], [l / 2 + 1, 0, 0, 2, 10, 14, '#A8AFB5'],
  ];
  for (let i = 0; i < 8; i++) details.push([-38 + 8 + i * 8.4 + 1.6, 28, avant + 0.7, 3.2, 10, 0.4, OR_CONTACT]);
  groupe.add(pieces(c, details));

  const leds = [];
  for (const s of [-1, 1]) {
    const led = c.boite(8, 6, 1, '#3A3F3C', { lumineux: true, ombre: false });
    led.position.set(s * (l / 2 - 13), 36, avant + 0.5);
    const lueurLed = plaqueLumineuse(c, 22, 22, '#FFFFFF', { debout: true });
    lueurLed.position.set(led.position.x, 39, avant + 1.4);
    groupe.add(led, lueurLed);
    leds.push([led, lueurLed]);
  }
  groupe.userData.maj = (temps, ctx) => {
    const sy = ctx.ville.systeme;
    const saturation = ctx.trafic.saturation.get('aeroport') ?? 0;
    const activite = Math.min(1, Math.log2(1 + ((sy?.reseau_recu ?? 0) + (sy?.reseau_envoye ?? 0)) / 1024) / 12);
    const clignote = activite > 0.05 && Math.sin(temps / (60 + 240 * (1 - activite))) > 0;
    const etats = [[saturation > 0 ? ROUGE : '#6CFF8E', clignote || saturation > 0], ['#FFB347', activite > 0.2]];
    etats.forEach(([couleur, allumee], i) => {
      const [led, lueurLed] = leds[i];
      led.material.color.set(allumee ? couleur : '#3A3F3C');
      led.material.emissive.set(couleur);
      led.material.emissiveIntensity = allumee ? 1 : 0;
      lueurLed.visible = allumee;
      lueurLed.material.color.set(couleur);
      lueurLed.material.opacity = 0.5;
    });
  };
  groupe.userData.hauteur = HAUT;
  return groupe;
}

// ---------- Volumes fixes ----------

// Vis de fixation dans les quatre trous de la carte (les trous sont dessinés sur le sol).
export function extras(v, c) {
  const b = v.bornes;
  if (!b) return null;
  const groupe = new c.THREE.Group();
  const fentes = [];
  for (const [x, y] of [[b.x + 30, b.y + 30], [b.x + b.l - 30, b.y + 30], [b.x + 30, b.y + b.h - 30], [b.x + b.l - 30, b.y + b.h - 30]]) {
    const tete = c.cylindre(8, 3, '#C4CACF', { faces: 20, rHaut: 7 });
    tete.position.set(x, 0, y);
    groupe.add(tete);
    fentes.push([x, 3, y, 10, 0.5, 1.6, '#5A6066', Math.PI / 4], [x, 3, y, 1.6, 0.5, 10, '#5A6066', Math.PI / 4]);
  }
  groupe.add(pieces(c, fentes, { ombre: false }));
  return groupe;
}
