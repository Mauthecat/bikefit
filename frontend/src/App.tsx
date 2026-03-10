// frontend/src/App.tsx
import React, { useEffect, useRef, useState } from 'react';
import { Pose } from '@mediapipe/pose';
import type { Results } from '@mediapipe/pose';
import { Camera } from '@mediapipe/camera_utils';
import { MotorBiomecanico } from './logic/MotorBiomecanico';
import { Activity, ChevronRight, Settings, Save, X, User, Bike, Ruler, Printer, FileText } from 'lucide-react';
import { jsPDF } from 'jspdf';
import './index.css';

type ViewMode = 'SIDE' | 'FRONT' | 'BACK';
type Disciplina = 'ROAD' | 'MTB' | 'TT';

interface MetricState { value: string; label: string; }

// --- IBFI NIVEL 3: AGREGAMOS STACK Y REACH AL SETUP MECÁNICO ---
interface CiclistaData {
  nombre: string;
  altura: number;
  entrepierna: number;
  disciplina: Disciplina;
  marcaBici: string;
  largoBiela: number;
  tipoPedal: string;
  stackBici: number; // NUEVO
  reachBici: number; // NUEVO
}

const App = () => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [view, setView] = useState<ViewMode>('SIDE');
  const [isDetected, setIsDetected] = useState(false);
  
  const [showSettings, setShowSettings] = useState(true); 
  const [ciclista, setCiclista] = useState<CiclistaData>({
    nombre: 'Nuevo Ciclista',
    altura: 175,
    entrepierna: 82,
    disciplina: 'ROAD',
    marcaBici: 'Massi',
    largoBiela: 172.5,
    tipoPedal: 'Shimano SPD-SL',
    stackBici: 540, // Valor referencial Talla M
    reachBici: 385  // Valor referencial Talla M
  });
  
  const [isCalibrating, setIsCalibrating] = useState(false);
  const [calibPoints, setCalibPoints] = useState<{x: number, y: number}[]>([]);
  const [pxPerCm, setPxPerCm] = useState<number>(10); 
  const ruedaRefCm = 68; 

  const [metrics, setMetrics] = useState<any>({});
  const latestMetricsRef = useRef<any>({});
  
  const savedMetricsGlobalRef = useRef<any>({ SIDE: {}, FRONT_BACK: {} });

  const [showReportModal, setShowReportModal] = useState(false);
  const [fitterNotes, setFitterNotes] = useState<string>('');

  const historyRef = useRef<any>({ 
    cadera: [], rodilla: [], tobillo: [], hombro: [], 
    codo: [], muneca: [], pie_indice: [], hip_l: [], hip_r: [] 
  });

  useEffect(() => {
    if (!videoRef.current || !canvasRef.current) return;

    const pose = new Pose({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`,
    });

    pose.setOptions({
      modelComplexity: 1,
      smoothLandmarks: true,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5
    });

    pose.onResults(onResults);

    const camera = new Camera(videoRef.current, {
      onFrame: async () => {
        if (videoRef.current) await pose.send({ image: videoRef.current });
      },
      width: 640,
      height: 480 
    });
    camera.start();

    return () => { camera.stop(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]); 

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isCalibrating) return;
    
    const rect = canvasRef.current!.getBoundingClientRect();
    const scaleX = canvasRef.current!.width / rect.width;
    const scaleY = canvasRef.current!.height / rect.height;
    
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    const newPts = [...calibPoints, {x, y}];
    
    if (newPts.length === 2) {
      const dx = newPts[1].x - newPts[0].x;
      const dy = newPts[1].y - newPts[0].y;
      const distPx = Math.sqrt(dx * dx + dy * dy);
      
      const pixelsPerCm = distPx / ruedaRefCm;
      setPxPerCm(pixelsPerCm);
      setIsCalibrating(false);
      setCalibPoints([]);
      alert(`✅ Calibración exacta.\nAhora el KOPS se medirá en milímetros reales.`);
    } else {
      setCalibPoints(newPts);
    }
  };

  const processBiomechanics = (pts: any) => {
    const h = historyRef.current;
    
    h.cadera.push(pts.hip); h.rodilla.push(pts.k); h.tobillo.push(pts.a);
    h.hombro.push(pts.h); h.codo.push(pts.c); h.muneca.push(pts.m);
    h.pie_indice.push(pts.f); h.hip_l.push(pts.hl); h.hip_r.push(pts.hr);

    if (h.cadera.length >= 40) {
      const motor = new MotorBiomecanico({ ...h });
      
      const currentCalculations = {
        rodilla: motor.getAlturaAsiento().toFixed(1),
        rodilla_pms: motor.getFlexionRodillaPMS().toFixed(1),
        torso: motor.getAnguloTorso().toFixed(1),
        brazos: motor.getExtensionBrazos().toFixed(1),
        tobillo: motor.getDinamicaTobillo().toFixed(1),
        pelvis: motor.getInclinacionPelvica().toFixed(1),
        kops: motor.getKOPS(pxPerCm).toFixed(1),
        rodilla_desvio: motor.getValgoVaroRodilla(pxPerCm).toFixed(1)
      };

      setMetrics(currentCalculations);
      latestMetricsRef.current = currentCalculations; 

      if (view === 'SIDE') {
        savedMetricsGlobalRef.current.SIDE = currentCalculations;
      } else {
        savedMetricsGlobalRef.current.FRONT_BACK = currentCalculations;
      }
      
      Object.keys(h).forEach(k => h[k] = []);
    }
  };

  const onResults = (res: Results) => {
    if (!canvasRef.current) return;
    const ctx = canvasRef.current.getContext('2d')!;
    const { width, height } = canvasRef.current;

    ctx.save();
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(res.image, 0, 0, width, height);

    if (res.poseLandmarks && !isCalibrating) {
      setIsDetected(true);
      const lm = res.poseLandmarks;

      const pts = {
        h: { x: lm[12].x * width, y: lm[12].y * height },
        c: { x: lm[14].x * width, y: lm[14].y * height },
        m: { x: lm[16].x * width, y: lm[16].y * height },
        hip: { x: lm[24].x * width, y: lm[24].y * height },
        k: { x: lm[26].x * width, y: lm[26].y * height },
        a: { x: lm[28].x * width, y: lm[28].y * height },
        f: { x: lm[32].x * width, y: lm[32].y * height },
        hl: { x: lm[23].x * width, y: lm[23].y * height },
        hr: { x: lm[24].x * width, y: lm[24].y * height },
      };

      renderHUD(ctx, pts, view);
      if (!showSettings && !showReportModal) processBiomechanics(pts); 
    } else {
      setIsDetected(false);
    }
    
    if (calibPoints.length > 0) {
      ctx.fillStyle = '#FF3B3B';
      ctx.beginPath();
      ctx.arc(calibPoints[0].x, calibPoints[0].y, 6, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  };

  const renderHUD = (ctx: CanvasRenderingContext2D, pts: any, mode: ViewMode) => {
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.font = 'bold 16px Arial';
    
    const m = latestMetricsRef.current; 

    if (mode === 'SIDE') {
      ctx.strokeStyle = '#20C20E';
      ctx.beginPath();
      ctx.moveTo(pts.h.x, pts.h.y); ctx.lineTo(pts.hip.x, pts.hip.y); 
      ctx.moveTo(pts.h.x, pts.h.y); ctx.lineTo(pts.c.x, pts.c.y); ctx.lineTo(pts.m.x, pts.m.y);
      ctx.moveTo(pts.hip.x, pts.hip.y); ctx.lineTo(pts.k.x, pts.k.y); ctx.lineTo(pts.a.x, pts.a.y);
      ctx.stroke();

      [pts.h, pts.c, pts.m, pts.hip, pts.k, pts.a].forEach(p => drawJoint(ctx, p));

      ctx.fillStyle = '#20C20E';
      if (m.rodilla) ctx.fillText(`${m.rodilla}°`, pts.k.x + 15, pts.k.y);
      if (m.torso) ctx.fillText(`${m.torso}°`, pts.hip.x - 40, pts.hip.y - 40);
      if (m.brazos) ctx.fillText(`${m.brazos}°`, pts.c.x + 15, pts.c.y);
      if (m.tobillo) ctx.fillText(`${m.tobillo}°`, pts.a.x + 15, pts.a.y);

    } else {
      ctx.strokeStyle = '#FF3B3B';
      ctx.beginPath();
      ctx.moveTo(pts.hl.x, pts.hl.y); ctx.lineTo(pts.hr.x, pts.hr.y);
      ctx.stroke();
      [pts.hl, pts.hr].forEach(p => drawJoint(ctx, p, '#FF3B3B'));

      ctx.fillStyle = '#FF3B3B';
      if (m.pelvis) ctx.fillText(`${m.pelvis}°`, pts.hr.x + 15, pts.hr.y - 15);
    }
  };

  const drawJoint = (ctx: CanvasRenderingContext2D, p: any, color: string = '#20C20E') => {
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath(); ctx.arc(p.x, p.y, 6, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke();
  };

  const getIdeals = (disciplina: Disciplina) => {
    switch (disciplina) {
      case 'MTB': return { rodilla: '135°-145°', torso: '45°-55°', brazos: '140°-160°', pms: '70°-80°', tobillo: '10°-20°' };
      case 'TT':  return { rodilla: '140°-150°', torso: '15°-25°', brazos: '90°-120°', pms: '68°-75°', tobillo: '15°-25°' };
      default:    return { rodilla: '138°-145°', torso: '40°-50°', brazos: '150°-160°', pms: '70°-75°', tobillo: '10°-20°' };
    }
  };
  const currentIdeals = getIdeals(ciclista.disciplina);

  const generatePDF = () => {
    const doc = new jsPDF();
    const id = currentIdeals;
    const today = new Date().toLocaleDateString();
    
    const mSide = savedMetricsGlobalRef.current.SIDE;
    const mFront = savedMetricsGlobalRef.current.FRONT_BACK;

    doc.setFontSize(24);
    doc.setTextColor(32, 194, 14); 
    doc.text("XTEK SpA", 20, 20);
    
    doc.setFontSize(12);
    doc.setTextColor(50, 50, 50);
    doc.text("Reporte Clínico de Bike Fit (Estándar IBFI)", 20, 28);
    doc.setFontSize(10);
    doc.text(`Fecha: ${today}`, 160, 28);
    doc.line(20, 32, 190, 32);

    doc.setFillColor(245, 245, 245);
    doc.rect(20, 38, 80, 42, 'F'); // Ampliamos la caja gris
    doc.rect(110, 38, 80, 42, 'F'); // Ampliamos la caja gris

    doc.setFontSize(11);
    doc.setTextColor(0, 0, 0);
    doc.setFont("helvetica", "bold");
    doc.text("Perfil del Ciclista", 25, 45);
    doc.text("Setup de Bicicleta", 115, 45);
    
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(`Nombre: ${ciclista.nombre}`, 25, 52);
    doc.text(`Estatura: ${ciclista.altura} cm`, 25, 59);
    doc.text(`Entrepierna: ${ciclista.entrepierna} cm`, 25, 66);

    doc.text(`Modelo: ${ciclista.marcaBici} (${ciclista.disciplina})`, 115, 52);
    // AGREGAMOS STACK Y REACH AL PDF
    doc.text(`Stack / Reach: ${ciclista.stackBici} mm / ${ciclista.reachBici} mm`, 115, 59);
    doc.text(`Largo Biela: ${ciclista.largoBiela} mm`, 115, 66);
    doc.text(`Pedales: ${ciclista.tipoPedal}`, 115, 73);

    if (canvasRef.current) {
      const imgData = canvasRef.current.toDataURL("image/jpeg", 1.0);
      doc.addImage(imgData, 'JPEG', 35, 85, 140, 105);
    }

    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(32, 194, 14);
    doc.text("Diagnóstico Profesional y Ajustes Realizados", 20, 200);
    
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(0, 0, 0);
    const splitNotes = doc.splitTextToSize(fitterNotes || "No se registraron comentarios adicionales.", 170);
    doc.text(splitNotes, 20, 207);

    let startY = 207 + (splitNotes.length * 6) + 10;

    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(32, 194, 14);
    doc.text("Resumen Biomecánico General", 20, startY);
    
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(0, 0, 0);
    startY += 8;
    const lh = 7; 

    if (mSide.rodilla) {
      doc.text(`• Extensión de Rodilla: ${mSide.rodilla}° (Ideal: ${id.rodilla})`, 20, startY);
      doc.text(`• Flexión Rodilla (PMS): ${mSide.rodilla_pms}° (Ideal: ${id.pms})`, 20, startY + lh);
      doc.text(`• KOPS (Avance): ${mSide.kops} mm (Ideal: -10 a +10mm)`, 20, startY + lh*2);
      doc.text(`• Ángulo del Torso: ${mSide.torso}° (Ideal: ${id.torso})`, 115, startY);
      doc.text(`• Extensión Brazos: ${mSide.brazos}° (Ideal: ${id.brazos})`, 115, startY + lh);
      doc.text(`• Dinámica Tobillo: ${mSide.tobillo}° (Ideal: ${id.tobillo})`, 115, startY + lh*2);
      startY += lh*4;
    }

    if (mFront.pelvis) {
      doc.text(`• Dismetría Pélvica: ${mFront.pelvis}° (Ideal: 0° - 1.5°)`, 20, startY);
      doc.text(`• Desvío Rodilla: ${mFront.rodilla_desvio} mm (Ideal: < 15mm)`, 115, startY);
    } else {
      doc.setTextColor(150, 150, 150);
      doc.text(`* Evaluación frontal no guardada en esta sesión.`, 20, startY);
    }

    doc.save(`XTEK_FitReport_${ciclista.nombre.replace(/\s+/g, '_')}.pdf`);
    setShowReportModal(false); 
  };

  return (
    <div className="xtek-app relative">
      <aside className="sidebar">
        <div className="brand">
          <Activity color="#20C20E" size={32} />
          <span>Hola <small>MAMAHUEBO EVO</small></span>
        </div>
        
        <button 
          onClick={() => setShowSettings(true)}
          className="mb-6 w-full flex items-center justify-between p-3 bg-[#1a1a1a] border border-[#333] rounded-lg hover:border-[#20C20E] transition-colors"
        >
          <div className="flex items-center gap-3 text-white">
            <User size={18} className="text-[#20C20E]" />
            <div className="flex flex-col text-left">
              <span className="text-sm font-bold">{ciclista.nombre}</span>
              <span className="text-[10px] text-gray-500">{ciclista.disciplina} | Biela: {ciclista.largoBiela}mm</span>
            </div>
          </div>
          <Settings size={16} className="text-gray-400" />
        </button>

        <nav className="mb-8">
          {(['SIDE', 'FRONT', 'BACK'] as ViewMode[]).map((v) => (
            <button key={v} onClick={() => setView(v)} className={view === v ? 'active' : ''}>
              <ChevronRight size={18} /> {v === 'SIDE' ? 'Vista Lateral' : v === 'FRONT' ? 'Vista Frontal' : 'Vista Trasera'}
            </button>
          ))}
        </nav>

        <button 
          onClick={() => { setIsCalibrating(true); setCalibPoints([]); }}
          className={`mb-4 w-full flex items-center gap-2 p-3 rounded-lg font-bold transition-colors ${isCalibrating ? 'bg-[#FF3B3B] text-white' : 'bg-[#222] text-[#20C20E] hover:bg-[#333]'}`}
        >
          <Ruler size={18} /> {isCalibrating ? 'Haciendo clic...' : 'Calibrar Rueda (cm)'}
        </button>

        <button 
          onClick={() => setShowReportModal(true)}
          className="mb-auto w-full flex items-center gap-2 p-3 bg-[#20C20E] text-black rounded-lg font-bold hover:bg-green-400 transition-colors"
        >
          <FileText size={18} /> Generar Reporte Final
        </button>

        <div className="status-card mt-auto">
          <div className={`indicator ${isDetected ? 'online' : 'offline'}`}></div>
          <span>{isDetected ? 'Sujeto Detectado' : 'Buscando Ciclista...'}</span>
        </div>
      </aside>

      <main className="viewport flex flex-col items-center p-4 overflow-y-auto w-full">
        
        <div className="relative w-full max-w-3xl flex justify-center mb-6 bg-black rounded-xl overflow-hidden border border-[#333]">
          <video ref={videoRef} className="hidden-video" playsInline />
          <canvas 
            ref={canvasRef} 
            className={`max-w-full h-auto ${isCalibrating ? 'cursor-crosshair' : ''}`} 
            width={640} 
            height={480} 
            onClick={handleCanvasClick}
          />
          {isCalibrating && (
            <div className="absolute top-4 bg-red-600 text-white font-bold px-4 py-2 rounded-full animate-pulse">
              Haz clic en los bordes Superior e Inferior de la llanta.
            </div>
          )}
        </div>

        <div className="w-full max-w-5xl bg-[#121212] border border-[#333] rounded-xl p-6">
          <h3 className="text-[#20C20E] font-bold mb-4 uppercase tracking-widest text-sm flex justify-between">
            <span>Análisis IBFI - {view}</span>
            <span className="text-gray-500">{ciclista.marcaBici} | Biela {ciclista.largoBiela}mm</span>
          </h3>
          
          {view === 'SIDE' ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
              <MetricCard title="Rodilla (Extensión)" current={metrics.rodilla} ideal={currentIdeals.rodilla} />
              <MetricCard title="Rodilla (Flexión PMS)" current={metrics.rodilla_pms} ideal={currentIdeals.pms} alertIf={(val:number) => val < 68} alertMsg={`Biela de ${ciclista.largoBiela}mm larga`} />
              <MetricCard title="KOPS (Avance Rodilla)" current={metrics.kops} ideal="-10 a +10 mm" unit=" mm" />
              <MetricCard title="Ángulo Torso" current={metrics.torso} ideal={currentIdeals.torso} />
              <MetricCard title="Dinámica Tobillo" current={metrics.tobillo} ideal={currentIdeals.tobillo} />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              <MetricCard title="Inclinación Pélvica (Dismetría)" current={metrics.pelvis} ideal="0° - 1.5°" alertIf={(val:number) => val > 2.5} alertMsg="Revisar calas / Shims" />
              <MetricCard title="Desvío de Rodilla (Tracking)" current={metrics.rodilla_desvio} ideal="< 15 mm" unit=" mm"/>
            </div>
          )}
        </div>
      </main>

      {/* MODAL DE CONCLUSIONES Y REPORTE FINAL */}
      {showReportModal && (
        <div className="absolute inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#121212] border border-[#20C20E] p-8 rounded-xl w-full max-w-2xl shadow-2xl">
            <div className="flex justify-between items-center mb-6 border-b border-[#333] pb-4">
              <h2 className="text-xl font-bold text-white flex items-center gap-2">
                <FileText className="text-[#20C20E]" /> Conclusiones del Especialista
              </h2>
              <button onClick={() => setShowReportModal(false)} className="text-gray-500 hover:text-white">
                <X size={24} />
              </button>
            </div>
            
            <p className="text-gray-400 text-sm mb-4">
              Este texto aparecerá en el PDF final. Usa este espacio para explicarle al cliente su diagnóstico y qué ajustes físicos realizaste en la bicicleta.
            </p>

            <textarea 
              value={fitterNotes}
              onChange={(e) => setFitterNotes(e.target.value)}
              placeholder="Ej: Se observa un ángulo de torso muy cerrado por lo que se recomienda acortar la Tee en 10mm. Se corrigió la dismetría instalando un espaciador de 2mm en la zapatilla derecha..."
              className="w-full bg-[#1a1a1a] border border-[#333] rounded p-4 text-white outline-none focus:border-[#20C20E] h-40 resize-none mb-6"
            />

            <div className="flex gap-4">
              <button onClick={() => setShowReportModal(false)} className="w-1/3 bg-transparent border border-[#333] text-white font-bold py-3 rounded-lg hover:bg-[#222] transition-colors">
                Cancelar
              </button>
              <button onClick={generatePDF} className="w-2/3 bg-[#20C20E] text-black font-bold py-3 rounded-lg flex items-center justify-center gap-2 hover:bg-green-400 transition-colors">
                <Printer size={18} /> Descargar PDF Definitivo
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DE PRE-FIT INTERVIEW */}
      {showSettings && (
        <div className="absolute inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#121212] border border-[#333] p-8 rounded-xl w-full max-w-2xl shadow-2xl">
            <div className="flex justify-between items-center mb-6 border-b border-[#222] pb-4">
              <h2 className="text-xl font-bold text-white flex items-center gap-2">
                <Settings className="text-[#20C20E]" /> Pre-Fit Interview (IBFI Nivel 3)
              </h2>
              <button onClick={() => setShowSettings(false)} className="text-gray-500 hover:text-white"><X size={24} /></button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="space-y-4">
                <h3 className="text-[#20C20E] text-sm font-bold border-b border-[#333] pb-2 flex items-center gap-2"><User size={16}/> Perfil Físico</h3>
                <div>
                  <label className="block text-xs text-gray-400 mb-1 uppercase tracking-wider">Nombre del Ciclista</label>
                  <input type="text" value={ciclista.nombre} onChange={(e) => setCiclista({...ciclista, nombre: e.target.value})} className="w-full bg-[#1a1a1a] border border-[#333] rounded p-2 text-white outline-none focus:border-[#20C20E]" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-gray-400 mb-1 uppercase tracking-wider">Altura (cm)</label>
                    <input type="number" value={ciclista.altura} onChange={(e) => setCiclista({...ciclista, altura: Number(e.target.value)})} className="w-full bg-[#1a1a1a] border border-[#333] rounded p-2 text-white outline-none focus:border-[#20C20E]" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1 uppercase tracking-wider">Entrepierna (cm)</label>
                    <input type="number" value={ciclista.entrepierna} onChange={(e) => setCiclista({...ciclista, entrepierna: Number(e.target.value)})} className="w-full bg-[#1a1a1a] border border-[#333] rounded p-2 text-white outline-none focus:border-[#20C20E]" />
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <h3 className="text-[#20C20E] text-sm font-bold border-b border-[#333] pb-2 flex items-center gap-2"><Bike size={16}/> Setup Mecánico</h3>
                <div>
                  <label className="block text-xs text-gray-400 mb-1 uppercase tracking-wider">Marca/Modelo Bici</label>
                  <input type="text" value={ciclista.marcaBici} onChange={(e) => setCiclista({...ciclista, marcaBici: e.target.value})} className="w-full bg-[#1a1a1a] border border-[#333] rounded p-2 text-white outline-none focus:border-[#20C20E]" />
                </div>
                
                {/* NUEVOS CAMPOS: STACK Y REACH */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-gray-400 mb-1 uppercase tracking-wider">Stack (mm)</label>
                    <input type="number" value={ciclista.stackBici} onChange={(e) => setCiclista({...ciclista, stackBici: Number(e.target.value)})} className="w-full bg-[#1a1a1a] border border-[#333] rounded p-2 text-white outline-none focus:border-[#20C20E]" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1 uppercase tracking-wider">Reach (mm)</label>
                    <input type="number" value={ciclista.reachBici} onChange={(e) => setCiclista({...ciclista, reachBici: Number(e.target.value)})} className="w-full bg-[#1a1a1a] border border-[#333] rounded p-2 text-white outline-none focus:border-[#20C20E]" />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-gray-400 mb-1 uppercase tracking-wider">Largo Biela (mm)</label>
                    <select value={ciclista.largoBiela} onChange={(e) => setCiclista({...ciclista, largoBiela: Number(e.target.value)})} className="w-full bg-[#1a1a1a] border border-[#333] rounded p-2 text-white outline-none focus:border-[#20C20E]">
                      <option value="165">165 mm</option>
                      <option value="170">170 mm</option>
                      <option value="172.5">172.5 mm</option>
                      <option value="175">175 mm</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1 uppercase tracking-wider">Disciplina IBFI</label>
                    <select value={ciclista.disciplina} onChange={(e) => setCiclista({...ciclista, disciplina: e.target.value as Disciplina})} className="w-full bg-[#1a1a1a] border border-[#333] rounded p-2 text-white outline-none focus:border-[#20C20E]">
                      <option value="ROAD">Ruta (Road)</option>
                      <option value="MTB">Mountain Bike (MTB)</option>
                      <option value="TT">Triatlón / TT</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1 uppercase tracking-wider">Tipo de Pedal</label>
                  <input type="text" value={ciclista.tipoPedal} placeholder="Ej: Shimano SPD-SL" onChange={(e) => setCiclista({...ciclista, tipoPedal: e.target.value})} className="w-full bg-[#1a1a1a] border border-[#333] rounded p-2 text-white outline-none focus:border-[#20C20E]" />
                </div>
              </div>
            </div>

            <button onClick={() => setShowSettings(false)} className="mt-8 w-full bg-[#20C20E] text-black font-bold py-3 rounded-lg flex items-center justify-center gap-2 hover:bg-green-400 transition-colors">
              <Save size={18} /> Iniciar Análisis Clínico
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

const MetricCard = ({ title, current, ideal, unit = '°', alertIf, alertMsg }: any) => {
  const numericVal = parseFloat(current);
  const isAlert = alertIf && !isNaN(numericVal) ? alertIf(numericVal) : false;

  return (
    <div className={`p-4 rounded-lg border transition-colors ${isAlert ? 'bg-red-900/20 border-red-500/50' : 'bg-[#1a1a1a] border-[#222]'}`}>
      <div className="text-gray-400 text-[10px] uppercase mb-1 leading-tight h-8">{title}</div>
      <div className={`text-2xl font-bold mb-1 ${isAlert ? 'text-red-400' : 'text-white'}`}>
        {current ? current + unit : '--'}
      </div>
      <div className="text-[#20C20E] text-[10px] font-bold">Ideal: {ideal}</div>
      {isAlert && <div className="text-red-400 text-[10px] font-bold mt-1">⚠️ {alertMsg}</div>}
    </div>
  );
};

export default App;