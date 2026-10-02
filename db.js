// db.js - Capa de Abstracción de Base de Datos para CampuSafe
// CONECTADO A FIREBASE FIRESTORE EN LA NUBE

const firebaseConfig = {
  apiKey: "AIzaSyDNWFlw67z4VgE2JHy0P7FKbNvYkaau1CQ",
  authDomain: "campusafe-f6833.firebaseapp.com",
  projectId: "campusafe-f6833",
  storageBucket: "campusafe-f6833.firebasestorage.app",
  messagingSenderId: "276929341900",
  appId: "1:276929341900:web:b7df93ab877658af649569",
  measurementId: "G-DE28FF10XL"
};

// Initialize Firebase
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}
const firestore = firebase.firestore();

class FimeDatabase {
    constructor() {
        this.listeners = [];
        // Eliminado MockDB (LocalStorage), todo es la Nube.
    }

    // ==========================================
    // AUTENTICACIÓN (Sesión persistente)
    // ==========================================
    async ensureAuth() {
        if (this.authReady) return this.authReady;
        this.authReady = new Promise((resolve, reject) => {
            const off = firebase.auth().onAuthStateChanged(user => {
                off();
                if (user) resolve(user);
                else firebase.auth().signInAnonymously().then(c => resolve(c.user), reject);
            }, reject);
        }).catch(error => { this.authReady = null; throw error; });
        return this.authReady;
    }

    async login() {
        const identity = await this.ensureAuth();
        const user = { matricula: 'visitante', uid: identity.uid, role: 'student' };
        localStorage.setItem('fime_current_user', JSON.stringify(user));
        return user;
    }

    logout() {
        // Conservamos la sesión visitante para que mapa y feed sigan funcionando.
        localStorage.removeItem('fime_current_user');
    }

    getCurrentUser() {
        const u = localStorage.getItem('fime_current_user');
        try { const user = u ? JSON.parse(u) : null; return user?.uid ? { uid: user.uid, matricula: 'visitante', role: 'student' } : null; } catch { return null; }
    }

    // ==========================================
    // FIRESTORE ABSTRACTION (Base de Datos Real)
    // ==========================================
    
    // onSnapshot: Escucha cambios en tiempo real desde la Nube de Google
    onReportsSnapshot(callback, onError = error => this.showError(error)) {
        let off = null;
        let cancelled = false;
        this.ensureAuth().then(() => {
            if (cancelled) return;
            off = firestore.collection('reports').onSnapshot(snapshot => {
                const active = [];
                snapshot.forEach(doc => {
                    const r = { ...doc.data(), id: doc.id };
                    if (!['Bache','Tráfico','Bloqueo','trafico','cerrada'].includes(r.type)) return;
                    r.type = ({ trafico: 'Tráfico', cerrada: 'Bloqueo' })[r.type] || r.type;
                    if (['resolved', 'resuelto'].includes(r.status)) return;
                    if (!r.location || !Number.isFinite(r.location.lat) || !Number.isFinite(r.location.lng)) return;
                    // Conservamos reportes históricos; la caducidad se gestiona en verificación.
                    active.push(r);
                });
                callback(active);
            }, onError);
        }).catch(onError);
        return () => { cancelled = true; if (off) off(); };
    }

    showError(error) {
        console.error('Campusafe:', error);
        const message = error.code === 'permission-denied'
            ? 'Firebase no permite cargar o guardar los reportes. Revisa las reglas de acceso.'
            : 'No se pudo conectar con los reportes. Comprueba tu conexión e intenta de nuevo.';
        let notice = document.getElementById('database-error');
        if (!notice) {
            notice = document.createElement('div');
            notice.id = 'database-error';
            notice.setAttribute('role', 'alert');
            notice.style.cssText = 'position:fixed;top:12px;left:12px;right:12px;z-index:10000;padding:12px;background:#401820;color:#fff;border-radius:8px';
            document.body.appendChild(notice);
        }
        notice.textContent = message;
    }

    // addDoc: Guardar reporte en la nube
    async addReport(reportData) {
        const identity = await this.ensureAuth();
        
        // CIBERSEGURIDAD Y ESTABILIDAD: Firebase rechaza objetos complejos de Google Maps.
        // Sanitizamos los datos geográficos a texto plano JSON:
        const parseLatLng = (pos) => {
            if (!pos) return null;
            if (typeof pos.lat === 'function') return { lat: pos.lat(), lng: pos.lng() };
            return { lat: pos.lat, lng: pos.lng };
        };

        const newReport = {
            ...reportData,
            location: parseLatLng(reportData.location),
            cameraPosition: parseLatLng(reportData.cameraPosition),
            status: 'active',
            timestamp: Date.now(),
            userId: 'anonimo',
            ownerUid: identity.uid
        };
        
        try {
            const docRef = await firestore.collection("reports").add(newReport);
            newReport.id = docRef.id;
            return newReport;
        } catch(e) {
            console.error("Error añadiendo reporte: ", e);
            throw e;
        }
    }

    // updateDoc: Votar con incrementos atómicos para concurrencia
    async updateReportVotes(reportId, voteType) {
        await this.ensureAuth();
        const reportRef = firestore.collection("reports").doc(reportId);
        try {
            if (voteType === 'yes') {
                await reportRef.update({
                    votesYes: firebase.firestore.FieldValue.increment(1)
                });
            } else if (voteType === 'no') {
                await reportRef.update({
                    votesNo: firebase.firestore.FieldValue.increment(1)
                });
            }
        } catch(e) {
            console.error("Error votando: ", e);
            throw e;
        }
    }

    // updateDoc: Resolver problema (Dashboard Universitario)
    async resolveReport(reportId) {
        await this.ensureAuth();
        const reportRef = firestore.collection("reports").doc(reportId);
        try {
            await reportRef.update({
                status: 'resolved',
                resolvedAt: Date.now()
            });
        } catch(e) {
            console.error("Error resolviendo reporte: ", e);
            throw e;
        }
    }

    // ==========================================
    // SISTEMA DE VERIFICACIÓN (8 HORAS)
    // ==========================================
    
    async getReportsPendingVerification(userId) {
        await this.ensureAuth();
        try {
            const snapshot = await firestore.collection("reports")
                .where("ownerUid", "==", firebase.auth().currentUser.uid)
                 // Evitamos pedir verificar los resueltos
                .get();
                
            const pending = [];
            const now = Date.now();
            const EIGHT_HOURS = 8 * 60 * 60 * 1000;
            
            snapshot.forEach(doc => {
                const r = { id: doc.id, ...doc.data() };
                if (!['resolved', 'resuelto'].includes(r.status) && (['trafico', 'tráfico', 'cerrada', 'bloqueo'].includes(String(r.type).toLowerCase())) && (now - r.timestamp > EIGHT_HOURS)) {
                    pending.push(r);
                }
            });
            return pending;
        } catch(e) {
            console.error("Error obteniendo pendientes: ", e);
            return [];
        }
    }

    async renewReport(reportId) {
        await this.ensureAuth();
        const reportRef = firestore.collection("reports").doc(reportId);
        try {
            await reportRef.update({
                timestamp: Date.now() // Reiniciar el reloj
            });
        } catch(e) {
            console.error("Error renovando reporte: ", e);
            throw e;
        }
    }

    // getDocs: Para analíticas del Dashboard Institucional (Heatmap y Excel)
    async getAnalytics() {
        await this.ensureAuth();
        try {
            const snapshot = await firestore.collection("reports").get();
            let total = 0, active = 0, resolved = 0;
            const typeCount = {};
            const allReports = [];

            snapshot.forEach(doc => {
                const r = { id: doc.id, ...doc.data() };
                allReports.push(r);
                total++;
                if (r.status === 'resolved' || r.status === 'resuelto') resolved++;
                else active++;
                
                typeCount[r.type] = (typeCount[r.type] || 0) + 1;
            });

            return { total, active, resolved, typeCount, allReports };
        } catch(e) {
            console.error("Error en Analytics: ", e);
            return { total:0, active:0, resolved:0, typeCount:{}, allReports: [] };
        }
    }
}

// Instancia global
const db = new FimeDatabase();
