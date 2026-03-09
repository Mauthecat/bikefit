// frontend/src/logic/MotorBiomecanico.ts

export interface Point { x: number; y: number; visibility?: number; }
export type LandmarkHistory = { [key: string]: Point[] };

export class MotorBiomecanico {
    private data: LandmarkHistory;
    private pmiIdx: number = 0; // Punto Muerto Inferior (Biela abajo)
    private pmsIdx: number = 0; // Punto Muerto Superior (Biela arriba) - NUEVO
    private biela3Idx: number = 0; // Biela a las 3 en punto (horizontal adelante)

    constructor(rawData: LandmarkHistory) {
        this.data = this._aplicarFiltro(rawData);
        if (this.data['tobillo'] && this.data['tobillo'].length > 0) {
            this._sincronizarFases();
        }
    }

    private _aplicarFiltro(rawData: LandmarkHistory): LandmarkHistory {
        const filtered: LandmarkHistory = {};
        for (const key in rawData) {
            filtered[key] = rawData[key].map((_, i, arr) => {
                const window = arr.slice(Math.max(0, i - 2), i + 3);
                return {
                    x: window.reduce((s, p) => s + p.x, 0) / window.length,
                    y: window.reduce((s, p) => s + p.y, 0) / window.length
                };
            });
        }
        return filtered;
    }

    private _sincronizarFases() {
        const tobilloY = this.data['tobillo'].map(p => p.y);
        const tobilloX = this.data['tobillo'].map(p => p.x);
        
        // En un canvas, Y=0 es arriba y Y=alto es abajo.
        this.pmiIdx = tobilloY.indexOf(Math.max(...tobilloY)); // Pie más abajo (Extensión max)
        this.pmsIdx = tobilloY.indexOf(Math.min(...tobilloY)); // Pie más arriba (Flexión max) - NUEVO
        this.biela3Idx = tobilloX.indexOf(Math.max(...tobilloX)); // Pie más adelantado
    }

    public calcularAngulo(A: Point, B: Point, C: Point): number {
        if (!A || !B || !C) return 0;
        const rad = Math.atan2(C.y - B.y, C.x - B.x) - Math.atan2(A.y - B.y, A.x - B.x);
        let angle = Math.abs(rad * 180 / Math.PI);
        if (angle > 180) angle = 360 - angle;
        return angle;
    }

    // ==========================================
    // VISTA LATERAL (SIDE VIEW)
    // ==========================================

    // Nivel 1: Saddle Height
    public getAlturaAsiento(): number {
        return this.calcularAngulo(this.data['cadera'][this.pmiIdx], this.data['rodilla'][this.pmiIdx], this.data['tobillo'][this.pmiIdx]);
    }

    // Nivel 2: Crank Length Assessment (NUEVO)
    // Evalúa si la biela es muy larga provocando flexión excesiva en la cadera/rodilla
    public getFlexionRodillaPMS(): number {
        return this.calcularAngulo(this.data['cadera'][this.pmsIdx], this.data['rodilla'][this.pmsIdx], this.data['tobillo'][this.pmsIdx]);
    }

    // Nivel 1: Saddle Fore-Aft (KOPS)
    public getKOPS(pxCm: number = 10): number {
        const rX = this.data['rodilla'][this.biela3Idx].x;
        const pX = this.data['pie_indice'][this.biela3Idx].x;
        return ((rX - pX) / pxCm) * 10;
    }

    public getExtensionBrazos(): number {
        const angles = this.data['hombro'].map((h, i) => this.calcularAngulo(h, this.data['codo'][i], this.data['muneca'][i]));
        return angles.reduce((a, b) => a + b, 0) / angles.length;
    }

    public getAnguloTorso(): number {
        const angles = this.data['cadera'].map((cad, i) => {
            const horizontal = { x: cad.x + 100, y: cad.y };
            return this.calcularAngulo(this.data['hombro'][i], cad, horizontal);
        });
        return angles.reduce((a, b) => a + b, 0) / angles.length;
    }

    public getDinamicaTobillo(): number {
        const t = this.data['tobillo'][this.pmiIdx];
        const p = this.data['pie_indice'][this.pmiIdx];
        const horiz = { x: t.x + 100, y: t.y };
        const ang = this.calcularAngulo(horiz, t, p);
        return p.y > t.y ? ang : -ang;
    }

    // ==========================================
    // VISTA FRONTAL/TRASERA 
    // ==========================================

    public getInclinacionPelvica(): number {
        const angles = this.data['hip_l'].map((hl, i) => {
            const hr = this.data['hip_r'][i];
            let angle = Math.atan2(hr.y - hl.y, hr.x - hl.x) * (180 / Math.PI);
            let deviation = Math.abs(angle);
            if (deviation > 90) deviation = Math.abs(180 - deviation);
            return deviation; 
        });
        return angles.reduce((a, b) => a + b, 0) / angles.length;
    }

    public getValgoVaroRodilla(pxCm: number = 10): number {
        const rodX = this.data['rodilla'].map(p => p.x);
        const pieX = this.data['pie_indice'].map(p => p.x);
        const desviaciones = rodX.map((rx, i) => Math.abs(rx - pieX[i]));
        return (desviaciones.reduce((a, b) => a + b, 0) / desviaciones.length / pxCm) * 10;
    }
}