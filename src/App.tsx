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
  unidad: string;
  codigo: string;
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
  const [rawCount, setRawCount] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [filterSede, setFilterSede] = useState('TODAS');
  const [filterProducto, setFilterProducto] = useState('');
  const [filterFamilia, setFilterFamilia] = useState<string[]>([]);
  const [familySearch, setFamilySearch] = useState('');
  const [showFamilyDropdown, setShowFamilyDropdown] = useState(false);
  const familyDropdownRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (familyDropdownRef.current && !familyDropdownRef.current.contains(event.target as Node)) {
        setShowFamilyDropdown(false);
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

    setIsProcessing(true);
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target?.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: 'array' });
        
        // Identify sheets: first one is Sales (Ventas), any sheet with "stock" in name is Stock
        const ventasSheetName = wb.SheetNames[0];
        const stockSheetName = wb.SheetNames.find((name) => 
          normalizeText(name).includes("stock")
        );

        const ventasJson = XLSX.utils.sheet_to_json<RawData>(wb.Sheets[ventasSheetName], { defval: null });
        let stockJson: RawData[] = [];
        if (stockSheetName) {
          stockJson = XLSX.utils.sheet_to_json<RawData>(wb.Sheets[stockSheetName], { defval: null });
        }
        
        if (!ventasJson.length) {
          setError("El archivo está vacío o no contiene datos de ventas válidos en la primera hoja.");
          setIsProcessing(false);
          return;
        }

        setRawCount(ventasJson.length);
        processData(ventasJson, stockJson);
        setIsProcessing(false);
      } catch (err) {
        setError("Error al procesar el archivo Excel. Asegúrate de que sea un formato válido.");
        console.error(err);
        setIsProcessing(false);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const processData = (ventasJson: RawData[], stockJson: RawData[] = []) => {
    const columns = Object.keys(ventasJson[0]).map((c) => String(c).trim());

    // 🔥 Detección más agresiva (incluye errores de encoding y alias comunes)
    let sedeCol = findColumn(columns, ["Sede", "Almacen", "Almacén", "almacen", "almacen", "almac", "alm", "Sucursal", "Sede/Almacen", "AlmacÃ©n"]);
    let fechaCol = findColumn(columns, ["Fecha", "fecha", "fec", "Date"]);
    let articuloCol = findColumn(columns, ["Producto", "Articulo", "Artículo", "Nombre", "ArtÃculo"]);
    let unidadCol = findColumn(columns, ["Unidad", "Unidad de Medida", "UM", "U.M.", "UOM", "Subarticulo", "Subartículo", "Presentacion", "Presentación", "Subartículo"]);
    let familiaCol = findColumn(columns, ["Subfamilia", "Familia", "familia", "fam", "Grupo", "Categoría"]);
    let ventaCol = findColumn(columns, ["Cantidad", "Venta", "venta", "valor", "Unidades", "Cant", "Qty"]);
    let costoUnitarioCol = findColumn(columns, ["Coste Unitario", "Costo Unitario", "Costo", "coste unitario", "coste", "precio", "Precio Costo", "Unit Cost"]);
    let codigoCol = findColumn(columns, ["Cód. Barras", "CÃ³d. Barras", "Cod. Barras", "Referencia", "Codigo", "Código"]);

    // ⚠️ Fallback automático por posición si falla la detección por nombre
    if (!sedeCol || !articuloCol || !ventaCol) {
      sedeCol = sedeCol || columns[0];
      fechaCol = fechaCol || columns[1];
      familiaCol = familiaCol || columns[2];
      articuloCol = articuloCol || columns[4] || columns[3];
      ventaCol = ventaCol || columns[6] || columns[5];
      costoUnitarioCol = costoUnitarioCol || columns[7];
    }

    // Process Stock sheet if available using Maps for better matching
    const stockMapByCode = new Map<string, number>();
    const stockMapByName = new Map<string, number>();

    if (stockJson.length > 0) {
      const stockCols = Object.keys(stockJson[0]).map(c => String(c).trim());
      const sSedeCol = findColumn(stockCols, ["Sede", "Almacen", "Sucursal", "Sede/Almacen", "Almacén", "AlmacÃ©n"]);
      const sArtCol = findColumn(stockCols, ["Producto", "Articulo", "Nombre", "Artículo", "ArtÃculo"]);
      const sSubArtCol = findColumn(stockCols, ["Subarticulo", "Subartículo", "Unidad", "Presentación", "Subartículo"]);
      const sCodeCol = findColumn(stockCols, ["Codigo", "Código", "Cód. Barras", "Referencia", "CÃ³d. Barras"]);
      const sStockCol = findColumn(stockCols, ["Stock", "Inventario", "Existencias", "Cant", "Cantidad", "Actual"]);
      
      if (sArtCol && sStockCol) {
        stockJson.forEach(row => {
          const sede = fixMojibake(row[sSedeCol!]);
          const producto = fixMojibake(row[sArtCol]);
          const subarticulo = sSubArtCol ? fixMojibake(row[sSubArtCol]) : "";
          const codigo = sCodeCol ? String(row[sCodeCol] || "").trim() : "";
          const stock = Number(row[sStockCol] || 0);

          if (sede && codigo) {
            const keyCode = `${normalizeText(sede)}__${normalizeText(codigo)}`;
            stockMapByCode.set(keyCode, (stockMapByCode.get(keyCode) || 0) + stock);
          }

          if (sede && producto) {
            const keyName = `${normalizeText(sede)}__${normalizeText(producto)}__${normalizeText(subarticulo)}`;
            stockMapByName.set(keyName, (stockMapByName.get(keyName) || 0) + stock);
          }
        });
      }
    }

    const grouped: Record<string, { producto: string; unidad: string; codigo: string; sede: string; familia: string; total: number }> = {};

    ventasJson.forEach((row) => {
      const rawProd = articuloCol ? row[articuloCol] : "";
      const rawUnidad = unidadCol ? row[unidadCol] : "—";
      const rawSede = sedeCol ? row[sedeCol] : "GENERAL";
      const rawFam = familiaCol ? row[familiaCol] : "SIN FAMILIA";
      const rawCode = codigoCol ? row[codigoCol] : "";
      
      const prodName = fixMojibake(rawProd);
      const unidad = fixMojibake(rawUnidad) || "—";
      const sede = fixMojibake(rawSede);
      const familia = fixMojibake(rawFam) || "SIN FAMILIA";
      const codigo = String(rawCode || "").trim();
      
      if (!prodName || prodName === "null" || prodName === "undefined") return;

      let cant = 0;
      const venta = Number(row[ventaCol!] || 0);
      const costoUnitario = costoUnitarioCol ? Number(row[costoUnitarioCol] || 0) : 0;
      
      const normalizedVentaCol = normalizeText(ventaCol);
      if ((normalizedVentaCol.includes("venta") || normalizedVentaCol.includes("valor")) && costoUnitario > 0) {
        cant = venta / costoUnitario;
      } else {
        cant = venta;
      }

      const key = `${prodName}_${unidad}_${sede}_${familia}`;
      if (!grouped[key]) {
        grouped[key] = { producto: prodName, unidad: unidad, codigo: codigo, sede: sede, familia: familia, total: 0 };
      }
      grouped[key].total += cant;
    });

    const processed = Object.values(grouped).map((item, index) => {
      const consumoDiario = item.total / 90;
      const minimo = consumoDiario * 1.5;
      const maximo = consumoDiario * 3;
      const safetyMargin = 1.25;
      
      // Try to find stock in lookup using dual strategy
      const keyCode = item.codigo ? `${normalizeText(item.sede)}__${normalizeText(item.codigo)}` : null;
      const keyName = `${normalizeText(item.sede)}__${normalizeText(item.producto)}__${normalizeText(item.unidad)}`;
      
      const stockActualPorCodigo = keyCode ? stockMapByCode.get(keyCode) : undefined;
      const stockActualPorNombre = stockMapByName.get(keyName);
      
      const actualStock = Number(stockActualPorCodigo ?? stockActualPorNombre ?? 0);
      
      return {
        id: `${index}-${item.producto}-${item.sede}`,
        producto: item.producto,
        unidad: item.unidad,
        codigo: item.codigo,
        sede: item.sede,
        familia: item.familia,
        totalVendido: item.total,
        consumoDiario,
        minimo,
        maximo,
        inventarioActual: actualStock,
        reposicion: Math.max(0, (maximo * safetyMargin) - actualStock)
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
    const totalProductos = new Set(filteredData.map(item => item.producto)).size;
    const totalSedes = new Set(filteredData.map(item => item.sede)).size;
    
    return {
      totalItems: filteredData.length,
      totalProductos,
      totalSedes,
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
      'Código': item.codigo,
      'Unidad': item.unidad,
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
      item.codigo,
      item.unidad,
      item.sede,
      item.familia,
      item.consumoDiario.toFixed(2),
      item.minimo.toFixed(2),
      item.maximo.toFixed(2),
      item.inventarioActual.toString(),
      item.reposicion.toFixed(0)
    ]);

    doc.autoTable({
      head: [['Producto', 'Código', 'Unidad', 'Sede', 'Familia', 'Cons. Diario', 'Mínimo', 'Máximo', 'Inv. Actual', 'Reposición']],
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
            ${isProcessing ? 'opacity-50 pointer-events-none' : ''}
          `}
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => { e.preventDefault(); setIsDragging(false); handleFileUpload(e); }}
        >
          <div className="max-w-md mx-auto space-y-4">
            <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center mx-auto">
              {isProcessing ? (
                <RefreshCw className="w-8 h-8 animate-spin" />
              ) : (
                <Upload className="w-8 h-8" />
              )}
            </div>
            <div className="space-y-2">
              <h3 className="text-xl font-semibold text-blue-900">
                {isProcessing ? 'Procesando datos...' : 'Cargar reporte de ventas'}
              </h3>
              <p className="text-blue-600/70 text-sm">
                {isProcessing 
                  ? 'Estamos analizando tu archivo Excel para generar el reporte.' 
                  : 'Sube tu archivo Excel. Detectamos automáticamente columnas como Almacén, Artículo, Venta, Coste Unitario.'}
              </p>
            </div>
            
            {!isProcessing && (
              <>
                <input 
                  type="file" 
                  ref={fileRef}
                  className="hidden" 
                  accept=".xlsx, .xls" 
                  onChange={handleFileUpload} 
                />

                <button
                  onClick={() => fileRef.current?.click()}
                  className="mt-6 inline-flex items-center gap-2 rounded-2xl bg-[#4f8fce] px-5 py-3 font-medium text-white transition hover:bg-[#3f7fbe] shadow-lg shadow-blue-200"
                >
                  <FileSpreadsheet className="h-5 w-5" />
                  Seleccionar archivo
                </button>
              </>
            )}

            {fileName && !error && (
              <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-[#e7f6ee] px-4 py-2 text-sm text-[#3a8b68]">
                <CheckCircle2 className="h-4 w-4" /> {fileName} cargado correctamente
              </div>
            )}

            {error && (
              <div className="mt-4 max-w-3xl rounded-2xl bg-[#fdecec] p-4 text-left text-sm text-[#c94b4b]">
                <div className="flex items-start gap-2">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </div>
              </div>
            )}
          </div>
        </motion.div>
      ) : (
        <>
          {/* Stats Grid */}
          <div className="grid grid-cols-1 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {/* Main KPI: Replenishment */}
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }} 
              animate={{ opacity: 1, scale: 1 }}
              className="md:col-span-2 lg:col-span-2 rounded-3xl bg-blue-600 p-6 text-white shadow-xl shadow-blue-100 flex flex-col justify-between relative overflow-hidden"
            >
              <div className="relative z-10">
                <p className="text-blue-100 text-sm font-medium">Total Reposición Sugerida</p>
                <h2 className="text-4xl font-bold mt-1">{formatNumber(stats?.totalReplenish, 0)}</h2>
                <p className="text-blue-200 text-xs mt-2 flex items-center gap-1">
                  <Package className="w-3 h-3" /> Unidades totales a pedir
                </p>
              </div>
              <RefreshCw className="absolute -right-4 -bottom-4 w-32 h-32 text-white/10 rotate-12" />
            </motion.div>

            {/* Secondary KPIs */}
            <div className="md:col-span-2 lg:col-span-4 grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center gap-2 text-slate-500 mb-2">
                  <FileSpreadsheet className="w-4 h-4" />
                  <span className="text-xs font-medium uppercase tracking-wider">Registros</span>
                </div>
                <div className="text-2xl font-bold text-slate-900">{rawCount}</div>
              </div>

              <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center gap-2 text-slate-500 mb-2">
                  <Package className="w-4 h-4" />
                  <span className="text-xs font-medium uppercase tracking-wider">Productos</span>
                </div>
                <div className="text-2xl font-bold text-slate-900">{stats?.totalProductos}</div>
              </div>

              <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center gap-2 text-slate-500 mb-2">
                  <MapPin className="w-4 h-4" />
                  <span className="text-xs font-medium uppercase tracking-wider">Sedes</span>
                </div>
                <div className="text-2xl font-bold text-slate-900">{stats?.totalSedes}</div>
              </div>

              <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center gap-2 text-red-500 mb-2">
                  <AlertCircle className="w-4 h-4" />
                  <span className="text-xs font-medium uppercase tracking-wider">Críticos</span>
                </div>
                <div className="text-2xl font-bold text-red-600">{stats?.lowStock}</div>
              </div>
            </div>
          </div>

          {/* Status Distribution */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="flex items-center gap-3 px-4 py-2 rounded-2xl bg-orange-50 border border-orange-100">
              <div className="w-2 h-2 rounded-full bg-orange-500" />
              <span className="text-xs font-medium text-orange-700">Alerta: {stats?.nearMinStock}</span>
            </div>
            <div className="flex items-center gap-3 px-4 py-2 rounded-2xl bg-emerald-50 border border-emerald-100">
              <div className="w-2 h-2 rounded-full bg-emerald-500" />
              <span className="text-xs font-medium text-emerald-700">Óptimo: {stats?.optimalStock}</span>
            </div>
            <div className="flex items-center gap-3 px-4 py-2 rounded-2xl bg-blue-50 border border-blue-100">
              <div className="w-2 h-2 rounded-full bg-blue-500" />
              <span className="text-xs font-medium text-blue-700">Sobrestock: {stats?.overStock}</span>
            </div>
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
                  onClick={() => setShowFamilyDropdown(!showFamilyDropdown)}
                  className="w-full text-left bg-transparent text-sm text-[#1f2a44] outline-none flex items-center justify-between"
                >
                  <span className="truncate">
                    {filterFamilia.length > 0 ? `${filterFamilia.length} seleccionadas` : "Seleccionar familias"}
                  </span>
                  <ChevronDown className={`w-4 h-4 text-[#6f8fb1] transition-transform ${showFamilyDropdown ? 'rotate-180' : ''}`} />
                </button>

                {showFamilyDropdown && (
                  <div className="absolute z-10 mt-2 w-full max-h-80 overflow-y-auto rounded-xl border border-[#cfe0ee] bg-white shadow-xl p-2 space-y-1 scrollbar-thin scrollbar-thumb-blue-200">
                    <div className="px-2 py-1.5 sticky top-0 bg-white border-b border-slate-100 mb-1">
                      <div className="flex items-center gap-2 px-2 py-1 bg-slate-50 rounded-lg border border-slate-200">
                        <Search className="w-3 h-3 text-slate-400" />
                        <input 
                          type="text" 
                          placeholder="Filtrar familias..." 
                          className="w-full bg-transparent text-[10px] outline-none text-slate-700"
                          value={familySearch}
                          onChange={(e) => setFamilySearch(e.target.value)}
                        />
                      </div>
                    </div>
                    <button 
                      onClick={() => {
                        const filtered = uniqueFamilias.filter(f => normalizeText(f).includes(normalizeText(familySearch)));
                        if (filterFamilia.length === filtered.length) {
                          setFilterFamilia([]);
                        } else {
                          setFilterFamilia([...filtered]);
                        }
                      }}
                      className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-[#f3f7fb] text-xs font-semibold text-blue-600 border-b border-blue-50 mb-1"
                    >
                      <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${filterFamilia.length === uniqueFamilias.filter(f => normalizeText(f).includes(normalizeText(familySearch))).length && uniqueFamilias.filter(f => normalizeText(f).includes(normalizeText(familySearch))).length > 0 ? 'bg-blue-600 border-blue-600' : 'border-blue-200'}`}>
                        {filterFamilia.length === uniqueFamilias.filter(f => normalizeText(f).includes(normalizeText(familySearch))).length && uniqueFamilias.filter(f => normalizeText(f).includes(normalizeText(familySearch))).length > 0 && <Check className="w-3 h-3 text-white" />}
                      </div>
                      Seleccionar visibles
                    </button>
                    {uniqueFamilias
                      .filter(f => normalizeText(f).includes(normalizeText(familySearch)))
                      .map(family => (
                        <label key={family} className="flex items-center gap-2 px-2 py-1.5 hover:bg-[#f3f7fb] rounded cursor-pointer transition-colors">
                          <input
                            type="checkbox"
                            className="hidden"
                            checked={filterFamilia.includes(family)}
                            onChange={() => {
                              if (filterFamilia.includes(family)) {
                                setFilterFamilia(filterFamilia.filter((f) => f !== family));
                              } else {
                                setFilterFamilia([...filterFamilia, family]);
                              }
                            }}
                          />
                          <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${filterFamilia.includes(family) ? 'bg-blue-600 border-blue-600' : 'border-blue-200'}`}>
                            {filterFamilia.includes(family) && <Check className="w-3 h-3 text-white" />}
                          </div>
                          <span className="text-xs text-[#1f2a44] truncate">{family}</span>
                        </label>
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
                    <th className="px-3 py-3">Unidad</th>
                    <th className="px-3 py-3 text-right">Consumo Diario</th>
                    <th className="px-3 py-3 text-right">Mínimo</th>
                    <th className="px-3 py-3 text-right">Máximo</th>
                    <th className="px-3 py-3 text-right">Stock Actual</th>
                    <th className="px-3 py-3 text-right">Reposición</th>
                  </tr>
                </thead>
                <tbody>
                  <AnimatePresence mode="popLayout">
                    {filteredData.map((item) => {
                      const isLow = item.inventarioActual < item.minimo;
                      const isNearMin = item.inventarioActual >= item.minimo && item.inventarioActual < item.minimo * 1.3;
                      const isOptimal = item.inventarioActual >= item.minimo * 1.3 && item.inventarioActual <= item.maximo;
                      const isOver = item.inventarioActual > item.maximo;

                      const progress = Math.min((item.inventarioActual / item.maximo) * 100, 100);

                      return (
                        <motion.tr 
                          key={item.id}
                          layout
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          className="border-b border-[#e2ebf3] hover:bg-[#f8fbfe] transition-colors"
                        >
                          <td className="px-3 py-4">
                            <div className="font-semibold text-[#1f2a44]">{item.producto}</div>
                            <div className="text-[10px] text-[#6f8fb1] flex flex-wrap items-center gap-x-2 gap-y-1 mt-1">
                              {item.codigo && <span className="bg-slate-100 px-1.5 py-0.5 rounded font-mono text-[9px]">{item.codigo}</span>}
                              <span className="flex items-center gap-1"><MapPin className="w-2.5 h-2.5" /> {item.sede}</span>
                              <span>•</span>
                              <span className="flex items-center gap-1"><Package className="w-2.5 h-2.5" /> {item.familia}</span>
                            </div>
                          </td>
                          <td className="px-3 py-4">
                            <div className="text-xs text-[#5f6b7a] font-medium">{item.unidad}</div>
                          </td>
                          <td className="px-3 py-4 text-right">
                            <div className="text-xs font-bold text-blue-600 bg-blue-50 py-1 px-2 rounded-lg border border-blue-100 inline-block min-w-[60px]">
                              {formatNumber(item.consumoDiario, 2)}
                            </div>
                          </td>
                          <td className="px-3 py-4 text-right">
                            <div className="text-xs font-medium text-[#5f6b7a] bg-[#f8fbfe] py-1 px-2 rounded-lg border border-[#e2e8f0] inline-block min-w-[60px]">
                              {formatNumber(item.minimo, 1)}
                            </div>
                          </td>
                          <td className="px-3 py-4 text-right">
                            <div className="text-xs font-medium text-[#5f6b7a] bg-[#f8fbfe] py-1 px-2 rounded-lg border border-[#e2e8f0] inline-block min-w-[60px]">
                              {formatNumber(item.maximo, 1)}
                            </div>
                          </td>
                          <td className="px-3 py-4 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <input 
                                type="number" 
                                value={item.inventarioActual || ''} 
                                onChange={(e) => updateInventory(item.id, e.target.value)}
                                placeholder="0"
                                className={`
                                  w-20 text-right py-1.5 px-3 rounded-xl border font-mono text-sm outline-none transition-all
                                  ${isLow ? 'border-red-200 bg-red-50 text-red-700 focus:ring-red-500' : 
                                    isNearMin ? 'border-orange-200 bg-orange-50 text-orange-700 focus:ring-orange-500' :
                                    isOptimal ? 'border-emerald-200 bg-emerald-50 text-emerald-700 focus:ring-emerald-500' :
                                    'border-blue-100 focus:ring-blue-500'}
                                `}
                              />
                            </div>
                          </td>
                          <td className="px-3 py-4 text-right">
                            <div className={`inline-block px-3 py-1 rounded-xl font-bold ${
                              item.reposicion > 0 ? 'bg-red-50 text-red-600 border border-red-100' : 'text-slate-300'
                            }`}>
                              {item.reposicion > 0 ? formatNumber(item.reposicion, 0) : '-'}
                            </div>
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
