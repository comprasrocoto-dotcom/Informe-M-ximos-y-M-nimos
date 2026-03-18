import React, { useState, useMemo, useCallback } from 'react';
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import 'jspdf-autotable';
import { 
  Upload, 
  FileSpreadsheet, 
  FileDown, 
  Search, 
  Filter, 
  AlertCircle, 
  CheckCircle2, 
  TrendingUp, 
  MapPin, 
  Package,
  Trash2,
  RefreshCw
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// Extend jsPDF with autotable
declare module 'jspdf' {
  interface jsPDF {
    autoTable: (options: any) => jsPDF;
  }
}

interface RawData {
  [key: string]: any;
}

interface InventoryItem {
  id: string;
  producto: string;
  sede: string;
  totalVendido: number;
  consumoDiario: number;
  minimo: number;
  maximo: number;
  inventarioActual: number;
  reposicion: number;
}

function fixMojibake(value: any): string {
  const text = String(value ?? "").trim();
  try {
    // Attempt to fix common encoding issues (UTF-8 bytes interpreted as ISO-8859-1)
    return decodeURIComponent(escape(text));
  } catch {
    return text;
  }
}

function normalizeText(value: any): string {
  return fixMojibake(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase();
}

function excelDateToJSDate(serial: any) {
  if (serial instanceof Date) return serial;
  if (typeof serial === "number") {
    const utcDays = Math.floor(serial - 25569);
    const utcValue = utcDays * 86400;
    return new Date(utcValue * 1000);
  }
  const parsed = new Date(serial);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatNumber(value: any, digits = 2) {
  return new Intl.NumberFormat("es-CO", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Number(value || 0));
}

function findColumn(columns: string[], aliases: string[]): string | null {
  const candidates = columns.map((col) => ({
    original: col,
    fixed: fixMojibake(col),
    normalized: normalizeText(col),
  }));

  for (const alias of aliases) {
    const target = normalizeText(alias);

    // 1. Exact match
    let match = candidates.find((c) => c.normalized === target);
    if (match) return match.original;

    // 2. Starts with
    match = candidates.find((c) => c.normalized.startsWith(target));
    if (match) return match.original;

    // 3. Includes
    match = candidates.find((c) => c.normalized.includes(target));
    if (match) return match.original;
  }

  return null;
}

export default function App() {
  const [data, setData] = useState<InventoryItem[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [filterSede, setFilterSede] = useState('');
  const [filterProducto, setFilterProducto] = useState('');

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement> | React.DragEvent) => {
    let file: File | undefined;
    setError(null);
    if ('files' in e.target && e.target.files) {
      file = e.target.files[0];
    } else if ('dataTransfer' in e && e.dataTransfer.files) {
      file = e.dataTransfer.files[0];
    }

    if (!file) return;
    setFileName(file.name);

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target?.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: 'array' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const rawJson = XLSX.utils.sheet_to_json<RawData>(ws, { defval: null });
        
        if (!rawJson.length) {
          setError("El archivo está vacío o no contiene datos válidos.");
          return;
        }

        processData(rawJson);
      } catch (err) {
        setError("Error al procesar el archivo Excel. Asegúrate de que sea un formato válido.");
        console.error(err);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const processData = (rawJson: RawData[]) => {
    const columns = Object.keys(rawJson[0]).map((c) => String(c).trim());

    const sedeCol = findColumn(columns, ["Sede", "Almacen", "Almacén", "Sucursal"]);
    const fechaCol = findColumn(columns, ["Fecha"]);
    const articuloCol = findColumn(columns, ["Articulo", "Artículo", "Producto"]);
    const subarticuloCol = findColumn(columns, ["Subarticulo", "Subartículo"]);
    const ventaCol = findColumn(columns, ["Cantidad", "Venta", "Unidades"]);
    const costoUnitarioCol = findColumn(columns, ["Coste Unitario", "Costo Unitario", "Costo", "Precio Costo"]);

    // Determine the best column for product name
    const productoCol = articuloCol || subarticuloCol;

    if (!sedeCol || !productoCol || !fechaCol || !ventaCol) {
      setError("No se encontraron las columnas necesarias (Almacén, Fecha, Artículo y Venta/Cantidad).");
      return;
    }

    const grouped: Record<string, { producto: string; sede: string; total: number }> = {};

    rawJson.forEach((row) => {
      const rawProd = articuloCol ? row[articuloCol] : "";
      const rawSub = subarticuloCol ? row[subarticuloCol] : "";
      
      let prodName = "";
      if (rawProd && rawSub) {
        prodName = `${fixMojibake(rawProd)} - ${fixMojibake(rawSub)}`;
      } else if (rawProd) {
        prodName = fixMojibake(rawProd);
      } else if (rawSub) {
        prodName = fixMojibake(rawSub);
      }
        
      const sede = fixMojibake(row[sedeCol]);
      
      let cant = 0;
      const venta = Number(row[ventaCol] || 0);
      const costoUnitario = costoUnitarioCol ? Number(row[costoUnitarioCol] || 0) : 0;
      
      // Calculate quantity: if it's a "Venta" column and we have unit cost, divide.
      // Otherwise assume it's already a quantity.
      if (normalizeText(ventaCol) === "venta" && costoUnitario > 0) {
        cant = venta / costoUnitario;
      } else {
        cant = venta;
      }

      if (!prodName || !sede) return;

      const key = `${prodName}_${sede}`;
      if (!grouped[key]) {
        grouped[key] = { producto: prodName, sede: sede, total: 0 };
      }
      grouped[key].total += cant;
    });

    const processed = Object.values(grouped).map((item, index) => {
      const consumoDiario = item.total / 90;
      const minimo = consumoDiario * 1.5;
      const maximo = consumoDiario * 3;
      const safetyMargin = 1.25;
      
      return {
        id: `${index}-${item.producto}-${item.sede}`,
        producto: item.producto,
        sede: item.sede,
        totalVendido: item.total,
        consumoDiario,
        minimo,
        maximo,
        inventarioActual: 0,
        reposicion: Math.max(0, maximo * safetyMargin) // Initial reposicion with 25% safety margin
      };
    });

    setData(processed);
  };

  const updateInventory = (id: string, value: string) => {
    const numValue = parseFloat(value) || 0;
    const safetyMargin = 1.25;
    setData(prev => prev.map(item => {
      if (item.id === id) {
        // Suggested replenishment = (Maximum * 1.25) - Current Inventory
        const reposicion = Math.max((item.maximo * safetyMargin) - numValue, 0);
        return { ...item, inventarioActual: numValue, reposicion };
      }
      return item;
    }));
  };

  const filteredData = useMemo(() => {
    return data.filter(item => 
      item.sede.toLowerCase().includes(filterSede.toLowerCase()) &&
      item.producto.toLowerCase().includes(filterProducto.toLowerCase())
    );
  }, [data, filterSede, filterProducto]);

  const stats = useMemo(() => {
    if (data.length === 0) return null;
    return {
      totalItems: data.length,
      lowStock: data.filter(item => item.inventarioActual < item.minimo).length,
      nearMinStock: data.filter(item => item.inventarioActual >= item.minimo && item.inventarioActual < item.minimo * 1.3).length,
      optimalStock: data.filter(item => item.inventarioActual >= item.minimo * 1.3 && item.inventarioActual <= item.maximo).length,
      overStock: data.filter(item => item.inventarioActual > item.maximo).length,
      totalReplenish: data.reduce((acc, item) => acc + item.reposicion, 0)
    };
  }, [data]);

  const exportToExcel = () => {
    const exportData = filteredData.map(item => ({
      'Producto': item.producto,
      'Sede': item.sede,
      'Consumo Diario': item.consumoDiario.toFixed(2),
      'Mínimo': item.minimo.toFixed(2),
      'Máximo': item.maximo.toFixed(2),
      'Inventario Actual': item.inventarioActual,
      'Reposición Sugerida': item.reposicion.toFixed(0)
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Inventario");
    XLSX.writeFile(wb, "Analisis_Inventario.xlsx");
  };

  const exportToPDF = () => {
    const doc = new jsPDF();
    doc.text("Análisis de Inventario Sugerido", 14, 15);
    
    const tableData = filteredData.map(item => [
      item.producto,
      item.sede,
      item.consumoDiario.toFixed(2),
      item.minimo.toFixed(2),
      item.maximo.toFixed(2),
      item.inventarioActual.toString(),
      item.reposicion.toFixed(0)
    ]);

    doc.autoTable({
      head: [['Producto', 'Sede', 'Cons. Diario', 'Mínimo', 'Máximo', 'Inv. Actual', 'Reposición']],
      body: tableData,
      startY: 25,
      theme: 'grid',
      styles: { fontSize: 8 }
    });

    doc.save("Analisis_Inventario.pdf");
  };

  const resetData = () => {
    setData([]);
    setFileName(null);
  };

  return (
    <div className="min-h-screen p-4 md:p-8 max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Smart Inventory</h1>
          <p className="text-slate-500">Análisis de reposición basado en consumo histórico</p>
        </div>
        
        <div className="flex items-center gap-3">
          {data.length > 0 && (
            <>
              <button onClick={exportToExcel} className="btn-secondary">
                <FileSpreadsheet className="w-4 h-4" />
                Excel
              </button>
              <button onClick={exportToPDF} className="btn-secondary">
                <FileDown className="w-4 h-4" />
                PDF
              </button>
              <button onClick={resetData} className="btn-secondary text-red-600 hover:bg-red-50 border-red-100">
                <Trash2 className="w-4 h-4" />
                Limpiar
              </button>
            </>
          )}
        </div>
      </header>

      {/* Upload Section */}
      {data.length === 0 ? (
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className={`
            relative border-2 border-dashed rounded-3xl p-12 text-center transition-all
            ${isDragging ? 'border-indigo-500 bg-indigo-50/50' : 'border-slate-200 bg-white'}
          `}
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => { e.preventDefault(); setIsDragging(false); handleFileUpload(e); }}
        >
          <div className="max-w-md mx-auto space-y-4">
            <div className="w-16 h-16 bg-indigo-100 text-indigo-600 rounded-2xl flex items-center justify-center mx-auto">
              <Upload className="w-8 h-8" />
            </div>
            <div className="space-y-2">
              <h3 className="text-xl font-semibold">Cargar reporte de ventas</h3>
              <p className="text-slate-500 text-sm">
                Sube tu archivo Excel. Detectamos automáticamente columnas como: <br />
                <span className="font-mono bg-slate-100 px-1 rounded text-[10px]">Almacén, Artículo, Venta, Coste Unitario</span>
              </p>
            </div>
            {error && (
              <div className="bg-red-50 text-red-600 p-3 rounded-xl text-sm flex items-center gap-2 justify-center border border-red-100">
                <AlertCircle className="w-4 h-4" />
                {error}
              </div>
            )}
            <label className="btn-primary w-fit mx-auto cursor-pointer">
              <Upload className="w-4 h-4" />
              Seleccionar archivo
              <input type="file" className="hidden" accept=".xlsx, .xls" onChange={handleFileUpload} />
            </label>
          </div>
        </motion.div>
      ) : (
        <>
          {/* Stats Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.1 }} className="card p-6 flex items-center gap-4">
              <div className="w-12 h-12 bg-red-100 text-red-600 rounded-xl flex items-center justify-center">
                <AlertCircle className="w-6 h-6" />
              </div>
              <div>
                <p className="text-sm text-slate-500 font-medium">Bajo Mínimo</p>
                <p className="text-2xl font-bold">{stats?.lowStock}</p>
              </div>
            </motion.div>

            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.2 }} className="card p-6 flex items-center gap-4">
              <div className="w-12 h-12 bg-orange-100 text-orange-600 rounded-xl flex items-center justify-center">
                <TrendingUp className="w-6 h-6" />
              </div>
              <div>
                <p className="text-sm text-slate-500 font-medium">Cerca del Mínimo</p>
                <p className="text-2xl font-bold">{stats?.nearMinStock}</p>
              </div>
            </motion.div>

            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.3 }} className="card p-6 flex items-center gap-4">
              <div className="w-12 h-12 bg-emerald-100 text-emerald-600 rounded-xl flex items-center justify-center">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <div>
                <p className="text-sm text-slate-500 font-medium">Stock Óptimo</p>
                <p className="text-2xl font-bold">{stats?.optimalStock}</p>
              </div>
            </motion.div>

            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.4 }} className="card p-6 flex items-center gap-4">
              <div className="w-12 h-12 bg-indigo-100 text-indigo-600 rounded-xl flex items-center justify-center">
                <RefreshCw className="w-6 h-6" />
              </div>
              <div>
                <p className="text-sm text-slate-500 font-medium">Total Reposición</p>
                <p className="text-2xl font-bold">{stats?.totalReplenish.toFixed(0)}</p>
              </div>
            </motion.div>
          </div>

          {/* Filters */}
          <div className="flex flex-col md:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input 
                type="text" 
                placeholder="Buscar producto..." 
                className="w-full pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all"
                value={filterProducto}
                onChange={(e) => setFilterProducto(e.target.value)}
              />
            </div>
            <div className="relative flex-1">
              <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input 
                type="text" 
                placeholder="Filtrar por sede..." 
                className="w-full pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all"
                value={filterSede}
                onChange={(e) => setFilterSede(e.target.value)}
              />
            </div>
          </div>

          {/* Table */}
          <div className="card">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-bottom border-slate-200">
                    <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Producto</th>
                    <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Sede</th>
                    <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider text-center">Consumo Diario</th>
                    <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider text-center">Mínimo</th>
                    <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider text-center">Máximo</th>
                    <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider text-center">Inv. Actual</th>
                    <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider text-center">Reposición</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  <AnimatePresence mode="popLayout">
                    {filteredData.map((item) => {
                      const isLow = item.inventarioActual < item.minimo;
                      const isNearMin = item.inventarioActual >= item.minimo && item.inventarioActual < item.minimo * 1.3;
                      const isOptimal = item.inventarioActual >= item.minimo * 1.3 && item.inventarioActual <= item.maximo;
                      const isOver = item.inventarioActual > item.maximo;

                      return (
                        <motion.tr 
                          key={item.id}
                          layout
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          className="hover:bg-slate-50/50 transition-colors"
                        >
                          <td className="px-6 py-4">
                            <div className="font-medium text-slate-900">{item.producto}</div>
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-1.5 text-slate-600 text-sm">
                              <MapPin className="w-3.5 h-3.5" />
                              {item.sede}
                            </div>
                          </td>
                          <td className="px-6 py-4 text-center font-mono text-sm text-slate-600">
                            {formatNumber(item.consumoDiario, 2)}
                          </td>
                          <td className="px-6 py-4 text-center font-mono text-sm text-slate-600">
                            {formatNumber(item.minimo, 2)}
                          </td>
                          <td className="px-6 py-4 text-center font-mono text-sm text-slate-600">
                            {formatNumber(item.maximo, 2)}
                          </td>
                          <td className="px-6 py-4 text-center">
                            <div className="flex items-center justify-center gap-2">
                              <div className={`w-2 h-2 rounded-full ${
                                isLow ? 'bg-red-500 animate-pulse' : 
                                isNearMin ? 'bg-orange-500' : 
                                isOptimal ? 'bg-emerald-500' : 
                                'bg-blue-500'
                              }`} />
                              <input 
                                type="number" 
                                value={item.inventarioActual || ''} 
                                onChange={(e) => updateInventory(item.id, e.target.value)}
                                placeholder="0"
                                className={`
                                  w-20 text-center py-1 px-2 rounded-lg border font-mono text-sm outline-none transition-all
                                  ${isLow ? 'border-red-200 bg-red-50 text-red-700 focus:ring-red-500' : 
                                    isNearMin ? 'border-orange-200 bg-orange-50 text-orange-700 focus:ring-orange-500' :
                                    isOptimal ? 'border-emerald-200 bg-emerald-50 text-emerald-700 focus:ring-emerald-500' :
                                    'border-slate-200 focus:ring-indigo-500'}
                                `}
                              />
                            </div>
                          </td>
                          <td className="px-6 py-4 text-center">
                            <span className={`
                              inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold
                              ${item.reposicion > 0 ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-400'}
                            `}>
                              {item.reposicion.toFixed(0)}
                            </span>
                          </td>
                        </motion.tr>
                      );
                    })}
                  </AnimatePresence>
                </tbody>
              </table>
              {filteredData.length === 0 && (
                <div className="p-12 text-center text-slate-400">
                  No se encontraron resultados para los filtros aplicados.
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* Footer Info */}
      <footer className="text-center text-slate-400 text-xs py-8">
        <p>© 2026 Smart Inventory Analyst • Basado en consumo de 90 días</p>
      </footer>
    </div>
  );
}
