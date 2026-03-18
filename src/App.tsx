import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
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
  RefreshCw,
  ChevronDown,
  Check
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
  familia: string;
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
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/Ã³|Ã“/g, "o")
    .replace(/Ã©|Ã‰/g, "e")
    .replace(/Ã¡|ÃÁ/g, "a")
    .replace(/Ã±|Ã‘/g, "n")
    .replace(/Ã•|ÃÍ/g, "i")
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
  const normalizedColumns = columns.map((c) => ({ original: c, normalized: normalizeText(c) }));
  for (const alias of aliases) {
    const normalizedAlias = normalizeText(alias);
    const found = normalizedColumns.find((c) => c.normalized === normalizedAlias || c.normalized.includes(normalizedAlias));
    if (found) return found.original;
  }
  return null;
}

export default function App() {
  const [data, setData] = useState<InventoryItem[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [filterSede, setFilterSede] = useState('TODAS');
  const [filterProducto, setFilterProducto] = useState('');
  const [filterFamilia, setFilterFamilia] = useState<string[]>([]);
  const [isFamilyDropdownOpen, setIsFamilyDropdownOpen] = useState(false);
  const familyDropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (familyDropdownRef.current && !familyDropdownRef.current.contains(event.target as Node)) {
        setIsFamilyDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

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
    
    // Reset filters when a new file is uploaded
    setFilterProducto('');
    setFilterSede('TODAS');
    setFilterFamilia([]);

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

    let sedeCol = findColumn(columns, ["Sede", "Almacen", "Almacén", "almacen", "almacen", "almac", "alm", "Sucursal"]);
    let fechaCol = findColumn(columns, ["Fecha", "fecha", "fec"]);
    let articuloCol = findColumn(columns, ["Producto", "Articulo", "Artículo", "Subarticulo", "Subartículo", "articulo", "subarticulo", "art", "subart"]);
    let familiaCol = findColumn(columns, ["Subfamilia", "Familia", "familia", "fam"]);
    let ventaCol = findColumn(columns, ["Cantidad", "Venta", "venta", "valor", "Unidades"]);
    let costoUnitarioCol = findColumn(columns, ["Coste Unitario", "Costo Unitario", "Costo", "coste unitario", "coste", "precio", "Precio Costo"]);

    // ⚠️ fallback automático si no detecta columnas
    if (!sedeCol || !fechaCol || !articuloCol || !ventaCol) {
      console.log("Columnas detectadas:", columns);
      sedeCol = sedeCol || columns[0];
      fechaCol = fechaCol || columns[1];
      familiaCol = familiaCol || columns[2];
      articuloCol = articuloCol || columns[4];
      ventaCol = ventaCol || columns[6];
      costoUnitarioCol = costoUnitarioCol || columns[7];
    }

    const grouped: Record<string, { producto: string; sede: string; familia: string; total: number }> = {};

    rawJson.forEach((row) => {
      const rawProd = articuloCol ? row[articuloCol] : "";
      const rawFam = familiaCol ? row[familiaCol] : "SIN FAMILIA";
      
      const prodName = fixMojibake(rawProd);
      const sede = fixMojibake(row[sedeCol!]);
      const familia = fixMojibake(rawFam) || "SIN FAMILIA";
      
      let cant = 0;
      const venta = Number(row[ventaCol!] || 0);
      const costoUnitario = costoUnitarioCol ? Number(row[costoUnitarioCol] || 0) : 0;
      
      // Calculate quantity: if it's a "Venta" column and we have unit cost, divide.
      // Otherwise assume it's already a quantity.
      const normalizedVentaCol = normalizeText(ventaCol);
      if ((normalizedVentaCol === "venta" || normalizedVentaCol === "valor") && costoUnitario > 0) {
        cant = venta / costoUnitario;
      } else {
        cant = venta;
      }

      if (!prodName || !sede) return;

      // Include familia in key to ensure correct filtering
      const key = `${prodName}_${sede}_${familia}`;
      if (!grouped[key]) {
        grouped[key] = { producto: prodName, sede: sede, familia: familia, total: 0 };
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
        familia: item.familia,
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
    const searchNormalized = normalizeText(filterProducto);
    return data.filter(item => {
      const matchText = 
        normalizeText(item.producto).includes(searchNormalized) ||
        normalizeText(item.sede).includes(searchNormalized) ||
        normalizeText(item.familia).includes(searchNormalized);
      
      const matchSede = filterSede === 'TODAS' || item.sede === filterSede;
      const matchFamilia = filterFamilia.length === 0 || filterFamilia.includes(item.familia);
      
      return matchText && matchSede && matchFamilia;
    });
  }, [data, filterSede, filterProducto, filterFamilia]);

  const uniqueSedes = useMemo(() => {
    const sedes = Array.from(new Set(data.map(item => item.sede)))
      .filter((s): s is string => typeof s === 'string' && s.trim() !== "")
      .sort();
    return ['TODAS', ...sedes];
  }, [data]);

  const uniqueFamilias = useMemo(() => {
    const familias = Array.from(new Set(data.map(item => item.familia)))
      .filter((f): f is string => typeof f === 'string' && f.trim() !== "")
      .sort();
    return familias;
  }, [data]);

  const stats = useMemo(() => {
    if (data.length === 0) return null;
    return {
      totalItems: filteredData.length,
      totalSedes: new Set(filteredData.map(item => item.sede)).size,
      lowStock: filteredData.filter(item => item.inventarioActual < item.minimo).length,
      nearMinStock: filteredData.filter(item => item.inventarioActual >= item.minimo && item.inventarioActual < item.minimo * 1.3).length,
      optimalStock: filteredData.filter(item => item.inventarioActual >= item.minimo * 1.3 && item.inventarioActual <= item.maximo).length,
      overStock: filteredData.filter(item => item.inventarioActual > item.maximo).length,
      totalReplenish: filteredData.reduce((acc, item) => acc + item.reposicion, 0)
    };
  }, [data, filteredData]);

  const clearFilters = () => {
    setFilterProducto('');
    setFilterSede('TODAS');
    setFilterFamilia([]);
  };

  const exportToExcel = () => {
    const exportData = filteredData.map(item => ({
      'Producto': item.producto,
      'Sede': item.sede,
      'Familia': item.familia,
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
      item.familia,
      item.consumoDiario.toFixed(2),
      item.minimo.toFixed(2),
      item.maximo.toFixed(2),
      item.inventarioActual.toString(),
      item.reposicion.toFixed(0)
    ]);

    doc.autoTable({
      head: [['Producto', 'Sede', 'Familia', 'Cons. Diario', 'Mínimo', 'Máximo', 'Inv. Actual', 'Reposición']],
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
          <h1 className="text-3xl font-bold text-blue-900 tracking-tight">Smart Inventory</h1>
          <p className="text-blue-600/70">Análisis de reposición basado en consumo histórico</p>
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
            ${isDragging ? 'border-blue-500 bg-blue-50/50' : 'border-blue-100 bg-white'}
          `}
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => { e.preventDefault(); setIsDragging(false); handleFileUpload(e); }}
        >
          <div className="max-w-md mx-auto space-y-4">
            <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center mx-auto">
              <Upload className="w-8 h-8" />
            </div>
            <div className="space-y-2">
              <h3 className="text-xl font-semibold text-blue-900">Cargar reporte de ventas</h3>
              <p className="text-blue-600/70 text-sm">
                Sube tu archivo Excel. Detectamos automáticamente columnas como: <br />
                <span className="font-mono bg-blue-50 px-1 rounded text-[10px] text-blue-600">Almacén, Artículo, Venta, Coste Unitario</span>
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
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.1 }} className="rounded-3xl border border-[#d7e3ef] bg-[#fdfdfd] p-5 shadow-sm flex items-center gap-4">
              <div className="w-12 h-12 bg-red-50 text-red-600 rounded-xl flex items-center justify-center">
                <AlertCircle className="w-6 h-6" />
              </div>
              <div>
                <p className="text-sm text-[#5f6b7a] font-medium">Bajo Mínimo</p>
                <p className="text-2xl font-bold text-[#1f2a44]">{stats?.lowStock}</p>
              </div>
            </motion.div>

            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.2 }} className="rounded-3xl border border-[#d7e3ef] bg-[#fdfdfd] p-5 shadow-sm flex items-center gap-4">
              <div className="w-12 h-12 bg-orange-50 text-orange-600 rounded-xl flex items-center justify-center">
                <TrendingUp className="w-6 h-6" />
              </div>
              <div>
                <p className="text-sm text-[#5f6b7a] font-medium">Cerca del Mínimo</p>
                <p className="text-2xl font-bold text-[#1f2a44]">{stats?.nearMinStock}</p>
              </div>
            </motion.div>

            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.3 }} className="rounded-3xl border border-[#d7e3ef] bg-[#fdfdfd] p-5 shadow-sm flex items-center gap-4">
              <div className="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-xl flex items-center justify-center">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <div>
                <p className="text-sm text-[#5f6b7a] font-medium">Stock Óptimo</p>
                <p className="text-2xl font-bold text-[#1f2a44]">{stats?.optimalStock}</p>
              </div>
            </motion.div>

            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.4 }} className="rounded-3xl border border-[#d7e3ef] bg-[#fdfdfd] p-5 shadow-sm flex items-center gap-4">
              <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center">
                <MapPin className="w-6 h-6" />
              </div>
              <div>
                <p className="text-sm text-[#5f6b7a] font-medium">Total Sedes</p>
                <p className="text-2xl font-bold text-[#1f2a44]">{stats?.totalSedes}</p>
              </div>
            </motion.div>

            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.5 }} className="rounded-3xl border border-[#d7e3ef] bg-red-50/30 p-5 shadow-sm flex items-center gap-4">
              <div className="w-12 h-12 bg-red-100 text-red-600 rounded-xl flex items-center justify-center">
                <RefreshCw className="w-6 h-6" />
              </div>
              <div>
                <p className="text-sm text-red-600 font-semibold">Total Reposición</p>
                <p className="text-2xl font-bold text-red-900">{stats?.totalReplenish.toFixed(0)}</p>
              </div>
            </motion.div>
          </div>

          {/* Filters */}
          <div className="rounded-3xl border border-[#d7e3ef] bg-[#fdfdfd] p-5 shadow-sm">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="flex items-center gap-3 rounded-2xl border border-[#cfe0ee] bg-[#f8fbfe] px-4 py-3">
                <Search className="h-4 w-4 text-[#6f8fb1]" />
                <input 
                  type="text" 
                  placeholder="Buscar por sede, producto o familias" 
                  className="w-full border-none bg-transparent text-sm text-[#1f2a44] outline-none"
                  value={filterProducto}
                  onChange={(e) => setFilterProducto(e.target.value)}
                />
              </div>

              <div className="rounded-2xl border border-[#cfe0ee] bg-[#f8fbfe] px-4 py-3 relative" ref={familyDropdownRef}>
                <button 
                  onClick={() => setIsFamilyDropdownOpen(!isFamilyDropdownOpen)}
                  className="w-full flex items-center justify-between text-sm text-[#1f2a44] outline-none"
                >
                  <span className="truncate">
                    {filterFamilia.length === 0 
                      ? "Seleccionar familias" 
                      : filterFamilia.length === uniqueFamilias.length 
                        ? "Todas las familias" 
                        : `${filterFamilia.length} seleccionadas`}
                  </span>
                  <ChevronDown className={`w-4 h-4 text-[#6f8fb1] transition-transform ${isFamilyDropdownOpen ? 'rotate-180' : ''}`} />
                </button>

                {isFamilyDropdownOpen && (
                  <div className="absolute top-full left-0 right-0 mt-2 bg-white border border-[#cfe0ee] rounded-2xl shadow-xl z-50 max-h-[300px] overflow-y-auto scrollbar-thin scrollbar-thumb-blue-200 p-2 space-y-1">
                    <button 
                      onClick={() => {
                        if (filterFamilia.length === uniqueFamilias.length) {
                          setFilterFamilia([]);
                        } else {
                          setFilterFamilia([...uniqueFamilias]);
                        }
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 rounded-xl hover:bg-blue-50 text-xs font-semibold text-blue-600 border-b border-blue-50 mb-1"
                    >
                      <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${filterFamilia.length === uniqueFamilias.length ? 'bg-blue-600 border-blue-600' : 'border-blue-200'}`}>
                        {filterFamilia.length === uniqueFamilias.length && <Check className="w-3 h-3 text-white" />}
                      </div>
                      Seleccionar todas
                    </button>
                    {uniqueFamilias.map(fam => (
                      <button 
                        key={fam}
                        onClick={() => {
                          if (filterFamilia.includes(fam)) {
                            setFilterFamilia(filterFamilia.filter(f => f !== fam));
                          } else {
                            setFilterFamilia([...filterFamilia, fam]);
                          }
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 rounded-xl hover:bg-blue-50 text-xs text-[#1f2a44] transition-colors"
                      >
                        <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${filterFamilia.includes(fam) ? 'bg-blue-600 border-blue-600' : 'border-blue-200'}`}>
                          {filterFamilia.includes(fam) && <Check className="w-3 h-3 text-white" />}
                        </div>
                        <span className="truncate">{fam}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-[#cfe0ee] bg-[#f8fbfe] px-4 py-3">
                <select 
                  className="w-full bg-transparent text-sm text-[#1f2a44] outline-none"
                  value={filterSede}
                  onChange={(e) => setFilterSede(e.target.value)}
                >
                  {uniqueSedes.map(sede => (
                    <option key={sede} value={sede}>{sede}</option>
                  ))}
                </select>
              </div>
            </div>
            
            {(filterProducto || filterSede !== 'TODAS' || filterFamilia.length > 0) && (
              <div className="mt-4 flex justify-end">
                <button 
                  onClick={clearFilters}
                  className="btn-secondary text-blue-600 border-blue-100 whitespace-nowrap"
                >
                  Limpiar filtros
                </button>
              </div>
            )}
          </div>

          {/* Table */}
          <div className="rounded-3xl border border-[#d7e3ef] bg-[#fdfdfd] p-5 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-[#cfe0ee] bg-[#e8f2fb] text-left text-[#5f6b7a]">
                    <th className="px-3 py-3">Producto</th>
                    <th className="px-3 py-3 text-right">Consumo diario</th>
                    <th className="px-3 py-3 text-right">Mínimo</th>
                    <th className="px-3 py-3 text-right">Máximo</th>
                    <th className="px-3 py-3 text-right">Inv. Actual</th>
                    <th className="px-3 py-3 text-right">Reposición sugerida</th>
                  </tr>
                </thead>
                <tbody>
                  <AnimatePresence mode="popLayout">
                    {filteredData.map((item) => {
                      const isLow = item.inventarioActual < item.minimo;
                      const isNearMin = item.inventarioActual >= item.minimo && item.inventarioActual < item.minimo * 1.3;
                      const isOptimal = item.inventarioActual >= item.minimo * 1.3 && item.inventarioActual <= item.maximo;

                      return (
                        <motion.tr 
                          key={item.id}
                          layout
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          className="border-b border-[#e2ebf3] hover:bg-[#f8fbfe]"
                        >
                          <td className="px-3 py-3">
                            <div className="font-medium text-[#314155]">{item.producto}</div>
                            <div className="text-[10px] text-[#6f8fb1] flex gap-2">
                              <span>{item.sede}</span>
                              <span>•</span>
                              <span>{item.familia}</span>
                            </div>
                          </td>
                          <td className="px-3 py-3 text-right text-[#5f6b7a] font-mono">
                            {formatNumber(item.consumoDiario, 2)}
                          </td>
                          <td className="px-3 py-3 text-right text-[#5f6b7a] font-mono">
                            {formatNumber(item.minimo, 2)}
                          </td>
                          <td className="px-3 py-3 text-right text-[#5f6b7a] font-mono">
                            {formatNumber(item.maximo, 2)}
                          </td>
                          <td className="px-3 py-3 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <div className={`w-1.5 h-1.5 rounded-full ${
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
                                  w-16 text-right py-1 px-2 rounded-lg border font-mono text-xs outline-none transition-all
                                  ${isLow ? 'border-red-200 bg-red-50 text-red-700 focus:ring-red-500' : 
                                    isNearMin ? 'border-orange-200 bg-orange-50 text-orange-700 focus:ring-orange-500' :
                                    isOptimal ? 'border-emerald-200 bg-emerald-50 text-emerald-700 focus:ring-emerald-500' :
                                    'border-blue-100 focus:ring-blue-500'}
                                `}
                              />
                            </div>
                          </td>
                          <td className="px-3 py-3 text-right font-semibold text-[#c94b4b]">
                            {formatNumber(item.reposicion, 0)}
                          </td>
                        </motion.tr>
                      );
                    })}
                  </AnimatePresence>
                </tbody>
              </table>
              {filteredData.length === 0 && (
                <div className="p-12 text-center text-[#6f8fb1]">
                  No se encontraron resultados para los filtros aplicados.
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* Footer Info */}
      <footer className="text-center text-blue-400 text-xs py-8">
        <p>© 2026 Smart Inventory Analyst • Basado en consumo de 90 días</p>
      </footer>
    </div>
  );
}
