import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Dumbbell, Link2, Download, ListChecks, Zap, Info, Loader2, ImagePlus, PlusCircle, Trash2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toPng } from 'html-to-image';
import { ExtractionResult } from './types';
import { extractWorkoutFromUrl } from './services/geminiService';

type ImgMap = Record<string, string>;

interface EditableRow {
  id: string;
  stage: string;
  actionName: string;
  repsSets: string;
  targetMuscle: string;
  notes: string;
}

function newEmptyRow(): EditableRow {
  return {
    id: `row-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    stage: '热身',
    actionName: '',
    repsSets: '',
    targetMuscle: '',
    notes: '',
  };
}

export default function App() {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<ExtractionResult | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [actionImgs, setActionImgs] = useState<ImgMap>({});
  // 独立行列表，支持增删排序
  const [rows, setRows] = useState<EditableRow[]>([]);
  const [exporting, setExporting] = useState(false);
  // 手机端导出预览图（null = 不显示弹窗）
  const [previewImg, setPreviewImg] = useState<string | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const progressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const progressRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const currentActionId = useRef<string>('');

  // ---------- 进度条 ----------
  // 使用非线性随机步进，避免长时间卡顿感
  useEffect(() => {
    if (loading) {
      progressRef.current = 0;
      setProgress(0);
      progressTimerRef.current = setInterval(() => {
        const cur = progressRef.current;
        // 越接近上限，步进越小；同时加入随机抖动让进度"活"起来
        const base = cur < 40 ? 4 : cur < 65 ? 2 : cur < 80 ? 1 : cur < 88 ? 0.6 : 0.2;
        const jitter = Math.random() * base * 0.6;
        const next = Math.min(cur + base + jitter, 92);
        progressRef.current = next;
        setProgress(next);
      }, 400);
    } else {
      if (progressTimerRef.current) {
        clearInterval(progressTimerRef.current);
        progressTimerRef.current = null;
      }
      if (progressRef.current > 0) {
        setProgress(100);
        setTimeout(() => { setProgress(0); progressRef.current = 0; }, 700);
      }
    }
    return () => { if (progressTimerRef.current) clearInterval(progressTimerRef.current); };
  }, [loading]);

  // ---------- 提取 ----------
  const handleExtract = async () => {
    if (!url) return;
    setLoading(true);
    setErrorMsg('');
    setResult(null);
    setActionImgs({});
    setRows([]);
    try {
      const data = await extractWorkoutFromUrl(url);
      setResult(data);
      // 初始化行列表
      setRows(data.actions.map((a) => ({
        id: a.id,
        stage: a.stage.replace(/\s+/g, ''),
        actionName: a.actionName,
        repsSets: a.repsSets,
        targetMuscle: a.targetMuscle,
        notes: a.notes,
      })));
    } catch (error: any) {
      setErrorMsg(error.message || '提取失败，请检查链接或稍后重试');
    } finally {
      setLoading(false);
    }
  };

  // ---------- 行操作 ----------
  const updateRow = useCallback((id: string, field: keyof Omit<EditableRow, 'id'>, value: string) => {
    setRows((prev) => prev.map((r) => r.id === id ? { ...r, [field]: value } : r));
  }, []);

  const deleteRow = useCallback((id: string) => {
    setRows((prev) => prev.filter((r) => r.id !== id));
    setActionImgs((prev) => { const n = { ...prev }; delete n[id]; return n; });
  }, []);

  // 在 afterId 行之后插入空白行（afterId 为 '__top__' 时插入到最前）
  const insertRowAfter = useCallback((afterId: string) => {
    const blank = newEmptyRow();
    setRows((prev) => {
      if (afterId === '__top__') return [blank, ...prev];
      const idx = prev.findIndex((r) => r.id === afterId);
      if (idx === -1) return [...prev, blank];
      const next = [...prev];
      next.splice(idx + 1, 0, blank);
      return next;
    });
  }, []);

  // ---------- 图片上传 ----------
  const openFilePicker = (actionId: string) => {
    currentActionId.current = actionId;
    fileInputRef.current?.click();
  };
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setActionImgs((prev) => ({ ...prev, [currentActionId.current]: ev.target?.result as string }));
    reader.readAsDataURL(file);
    e.target.value = '';
  };
  const handleDrop = (e: React.DragEvent, actionId: string) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = (ev) => setActionImgs((prev) => ({ ...prev, [actionId]: ev.target?.result as string }));
    reader.readAsDataURL(file);
  };

  // ---------- 导出长图（PNG）----------
  const saveAsImage = async () => {
    if (!resultsRef.current) return;
    setExporting(true);
    // 短暂等待 exporting 状态渲染（隐藏悬停样式等）
    await new Promise((r) => setTimeout(r, 80));
    try {
      const dataUrl = await toPng(resultsRef.current, {
        cacheBust: true,
        pixelRatio: 2,
        backgroundColor: '#ffffff',
      });
      // 手机端：弹出预览，让用户长按保存到相册
      // 桌面端：直接下载文件
      const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
      if (isMobile) {
        setPreviewImg(dataUrl);
      } else {
        const link = document.createElement('a');
        link.download = 'workout-plan.png';
        link.href = dataUrl;
        link.click();
      }
    } catch (err) {
      console.error('导出失败:', err);
      alert('导出失败，请稍后重试');
    } finally {
      setExporting(false);
    }
  };

  // ---------- 可编辑单元格组件 ----------
  const EditCell = ({
    value, onChange, className = '',
  }: { value: string; onChange: (v: string) => void; className?: string }) => (
    <div
      contentEditable={!exporting}
      suppressContentEditableWarning
      onBlur={(e) => onChange((e.target as HTMLDivElement).innerText.trim())}
      className={`outline-none rounded-lg px-1 -mx-1 transition-all
        ${!exporting ? 'hover:bg-emerald-50 focus:bg-white focus:ring-2 focus:ring-emerald-200 cursor-text' : ''}
        ${className}`}
      dangerouslySetInnerHTML={{ __html: value }}
    />
  );

  // ---------- 渲染 ----------
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans selection:bg-emerald-100">
      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />

      {/* 手机端导出预览弹窗 */}
      <AnimatePresence>
        {previewImg && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-black/80 flex flex-col items-center justify-start overflow-y-auto p-4"
            onClick={() => setPreviewImg(null)}
          >
            <div className="w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
              {/* 提示文字 */}
              <div className="flex items-center justify-between mb-3">
                <div className="text-white text-sm font-medium">
                  📥 长按图片 → 保存到相册
                </div>
                <button
                  onClick={() => setPreviewImg(null)}
                  className="text-white/70 hover:text-white text-xs px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 transition-all">
                  关闭
                </button>
              </div>
              {/* 图片主体，用户长按此处保存 */}
              <img
                src={previewImg}
                alt="训练计划"
                className="w-full rounded-2xl shadow-2xl"
                style={{ WebkitTouchCallout: 'default' }}
              />
              <p className="text-center text-white/50 text-xs mt-3">点击空白处关闭</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 顶部进度条 */}
      <div className="fixed top-0 left-0 right-0 z-[60] h-1 bg-transparent pointer-events-none">
        <motion.div
          className="h-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]"
          initial={{ width: '0%', opacity: 0 }}
          animate={{ width: `${progress}%`, opacity: progress > 0 ? 1 : 0 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
        />
      </div>

      {/* Header */}
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-emerald-500 rounded-xl text-white shadow-lg shadow-emerald-200">
              <Dumbbell className="w-6 h-6" />
            </div>
            <span className="text-xl font-bold tracking-tight">FitExtract</span>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-12">
        {/* Hero */}
        <section className="text-center mb-16">
          <motion.h1 initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
            className="text-4xl md:text-6xl font-extrabold mb-6 leading-tight">
            一键拆解健身长视频<br />
            <span className="text-emerald-500">生成你的专属训练表</span>
          </motion.h1>

          <div className="max-w-2xl mx-auto space-y-4">
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-slate-400">
                <Link2 className="w-5 h-5" />
              </div>
              <input type="text" value={url} onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleExtract()}
                placeholder="请粘贴抖音/B站健身视频链接..."
                className="w-full pl-12 pr-4 py-4 rounded-2xl border-none shadow-sm ring-1 ring-slate-200 focus:ring-2 focus:ring-emerald-500 transition-all text-slate-800 placeholder:text-slate-400 bg-white" />
            </div>
            <button onClick={handleExtract} disabled={loading || !url}
              className="w-full md:w-auto px-12 py-4 bg-emerald-500 text-white font-semibold rounded-2xl shadow-lg shadow-emerald-200 hover:bg-emerald-600 hover:shadow-xl hover:-translate-y-0.5 transition-all duration-200 disabled:opacity-50 disabled:translate-y-0">
              {loading ? (
                <span className="flex items-center gap-2 justify-center">
                  <Loader2 className="w-5 h-5 animate-spin" />
                  AI 分析中... {Math.round(progress)}%
                </span>
              ) : '一键提取 (Extract)'}
            </button>

            {loading && (
              <div>
                <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
                  <motion.div className="h-full bg-emerald-500 rounded-full"
                    animate={{ width: `${progress}%` }} transition={{ duration: 0.3, ease: 'easeOut' }} />
                </div>
                <div className="flex justify-between mt-1 text-xs text-slate-400">
                  <span>正在调用 AI 工作流...</span>
                  <span>{Math.round(progress)}%</span>
                </div>
              </div>
            )}
          </div>

          {errorMsg && (
            <div className="mt-4 max-w-2xl mx-auto px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm text-center">
              ⚠️ {errorMsg}
            </div>
          )}
        </section>

        {/* Results */}
        <AnimatePresence>
          {result && (
            <motion.section initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <h2 className="text-xl font-bold flex items-center gap-2">
                    <ListChecks className="text-emerald-500" />
                    解析结果
                  </h2>
                  <span className="text-xs text-slate-400 bg-slate-100 px-2 py-1 rounded-lg">
                    ✏️ 点击各单元格内容可直接编辑
                  </span>
                </div>
                <button onClick={saveAsImage} disabled={exporting}
                  className="flex items-center gap-2 px-4 py-2 bg-white text-slate-700 border border-slate-200 rounded-xl hover:bg-slate-50 shadow-sm transition-all text-sm font-medium disabled:opacity-60">
                  {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                  {exporting ? '导出中...' : '导出为长图 (Save as Image)'}
                </button>
              </div>

              {/* 截图区域 */}
              <div ref={resultsRef} className="bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden p-1">
                <div className="hidden md:block">
                  <table className="w-full text-left border-collapse">
                    <thead className="bg-slate-50 border-b border-slate-100">
                      <tr>
                        {['阶段', '动作名称', '容量', '针对肌群', '注意事项', '动作示例'].map((h) => (
                          <th key={h} className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider select-none">{h}</th>
                        ))}
                        {!exporting && <th className="px-2 py-4 w-16 select-none" />}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {/* 顶部插入行按钮 */}
                      {!exporting && (
                        <tr>
                          <td colSpan={7} className="px-6 py-1">
                            <button
                              onClick={() => insertRowAfter('__top__')}
                              className="w-full flex items-center justify-center gap-1 py-1 text-xs text-slate-300 hover:text-emerald-500 hover:bg-emerald-50 rounded-lg transition-all group">
                              <PlusCircle className="w-3.5 h-3.5" />
                              <span className="opacity-0 group-hover:opacity-100 transition-opacity">在最前插入行</span>
                            </button>
                          </td>
                        </tr>
                      )}
                      {rows.map((row) => (
                        <React.Fragment key={row.id}>
                          <tr className="hover:bg-slate-50/50 transition-colors group/row">
                            {/* 阶段 */}
                            <td className="px-6 py-4">
                              <span className="inline-flex px-2 py-1 bg-slate-100 text-slate-600 text-[10px] font-bold rounded-md whitespace-nowrap">
                                <EditCell value={row.stage} onChange={(v) => updateRow(row.id, 'stage', v)} />
                              </span>
                            </td>
                            {/* 动作名称 */}
                            <td className="px-6 py-4 font-semibold text-slate-900">
                              <EditCell value={row.actionName} onChange={(v) => updateRow(row.id, 'actionName', v)} />
                            </td>
                            {/* 容量 */}
                            <td className="px-6 py-4 text-slate-600">
                              <EditCell value={row.repsSets} onChange={(v) => updateRow(row.id, 'repsSets', v)} />
                            </td>
                            {/* 针对肌群 */}
                            <td className="px-6 py-4">
                              <span className="text-emerald-500 font-medium text-sm">
                                <EditCell value={row.targetMuscle} onChange={(v) => updateRow(row.id, 'targetMuscle', v)} />
                              </span>
                            </td>
                            {/* 注意事项 */}
                            <td className="px-6 py-4 text-sm text-slate-500 leading-relaxed max-w-xs">
                              <EditCell value={row.notes} onChange={(v) => updateRow(row.id, 'notes', v)} className="whitespace-pre-wrap" />
                            </td>
                            {/* 动作示例 */}
                            <td className="px-6 py-4">
                              {actionImgs[row.id] ? (
                                <div className={`relative w-36 h-[90px] rounded-xl overflow-hidden border border-slate-200 shadow-sm
                                  ${!exporting ? 'group cursor-pointer' : ''}`}
                                  onClick={() => !exporting && openFilePicker(row.id)}
                                  onDrop={(e) => handleDrop(e, row.id)}
                                  onDragOver={(e) => e.preventDefault()}>
                                  <img src={actionImgs[row.id]} alt="示例" className="w-full h-full object-cover" />
                                  {!exporting && (
                                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                      <span className="text-white text-xs font-medium">更换图片</span>
                                    </div>
                                  )}
                                </div>
                              ) : (
                                !exporting ? (
                                  <div onClick={() => openFilePicker(row.id)}
                                    onDrop={(e) => handleDrop(e, row.id)}
                                    onDragOver={(e) => e.preventDefault()}
                                    className="w-36 h-[90px] rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 flex flex-col items-center justify-center gap-1 cursor-pointer hover:border-emerald-400 hover:bg-emerald-50 transition-all group">
                                    <ImagePlus className="w-6 h-6 text-slate-300 group-hover:text-emerald-400 transition-colors" />
                                    <span className="text-[11px] text-slate-400 group-hover:text-emerald-500">点击上传图片</span>
                                  </div>
                                ) : (
                                  <div className="w-36 h-[90px] rounded-xl border-2 border-dashed border-slate-200 bg-slate-50" />
                                )
                              )}
                            </td>
                            {/* 操作列 */}
                            {!exporting && (
                              <td className="px-2 py-4">
                                <button
                                  onClick={() => deleteRow(row.id)}
                                  title="删除此行"
                                  className="p-1.5 rounded-lg text-slate-300 hover:text-red-400 hover:bg-red-50 transition-all opacity-0 group-hover/row:opacity-100">
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </td>
                            )}
                          </tr>
                          {/* 行间插入按钮 */}
                          {!exporting && (
                            <tr className="h-0">
                              <td colSpan={7} className="p-0">
                                <button
                                  onClick={() => insertRowAfter(row.id)}
                                  className="w-full flex items-center justify-center gap-1 py-1 text-xs text-slate-300 hover:text-emerald-500 hover:bg-emerald-50 rounded-lg transition-all group">
                                  <PlusCircle className="w-3.5 h-3.5" />
                                  <span className="opacity-0 group-hover:opacity-100 transition-opacity">在此行后插入</span>
                                </button>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Mobile Cards */}
                <div className="md:hidden space-y-4 p-4">
                  {/* 顶部插入 */}
                  {!exporting && (
                    <button onClick={() => insertRowAfter('__top__')}
                      className="w-full flex items-center justify-center gap-2 py-2 text-sm text-slate-400 hover:text-emerald-500 hover:bg-emerald-50 border-2 border-dashed border-slate-200 hover:border-emerald-300 rounded-2xl transition-all">
                      <PlusCircle className="w-4 h-4" /> 在最前插入行
                    </button>
                  )}
                  {rows.map((row) => (
                    <React.Fragment key={row.id}>
                      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
                        <div className="px-4 pt-4 pb-1 flex items-center justify-between">
                          <span className="inline-flex px-2 py-1 bg-slate-100 text-slate-600 text-[10px] font-bold rounded-md whitespace-nowrap">
                            <EditCell value={row.stage} onChange={(v) => updateRow(row.id, 'stage', v)} />
                          </span>
                          {!exporting && (
                            <button onClick={() => deleteRow(row.id)}
                              className="p-1.5 rounded-lg text-slate-300 hover:text-red-400 hover:bg-red-50 transition-all">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                        <div className="p-5 space-y-4">
                          <div className="flex justify-between items-start">
                            <div>
                              <div className="text-lg font-bold text-slate-900">
                                <EditCell value={row.actionName} onChange={(v) => updateRow(row.id, 'actionName', v)} />
                              </div>
                              <div className="text-emerald-500 font-medium text-sm">
                                <EditCell value={row.targetMuscle} onChange={(v) => updateRow(row.id, 'targetMuscle', v)} />
                              </div>
                            </div>
                            <div className="text-right">
                              <p className="text-[10px] font-bold text-slate-400 uppercase select-none">容量计划</p>
                              <div className="text-sm font-semibold text-slate-700">
                                <EditCell value={row.repsSets} onChange={(v) => updateRow(row.id, 'repsSets', v)} />
                              </div>
                            </div>
                          </div>
                          <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                            <p className="text-xs font-bold text-slate-400 mb-1 flex items-center gap-1 select-none">
                              <Info className="w-3 h-3" /> 注意事项
                            </p>
                            <div className="text-sm text-slate-600 leading-relaxed">
                              <EditCell value={row.notes} onChange={(v) => updateRow(row.id, 'notes', v)} className="whitespace-pre-wrap" />
                            </div>
                          </div>
                          <div>
                            <p className="text-xs font-bold text-slate-400 mb-2 select-none">📸 动作示例</p>
                            {actionImgs[row.id] ? (
                              <div className="relative w-full h-40 rounded-xl overflow-hidden border border-slate-200 group cursor-pointer"
                                onClick={() => openFilePicker(row.id)}>
                                <img src={actionImgs[row.id]} alt="示例" className="w-full h-full object-cover" />
                                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                  <span className="text-white text-sm font-medium">更换图片</span>
                                </div>
                              </div>
                            ) : (
                              <div onClick={() => openFilePicker(row.id)}
                                onDrop={(e) => handleDrop(e, row.id)}
                                onDragOver={(e) => e.preventDefault()}
                                className="w-full h-32 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 flex flex-col items-center justify-center gap-2 cursor-pointer hover:border-emerald-400 hover:bg-emerald-50 transition-all group">
                                <ImagePlus className="w-8 h-8 text-slate-300 group-hover:text-emerald-400 transition-colors" />
                                <span className="text-xs text-slate-400 group-hover:text-emerald-500">点击上传图片</span>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                      {/* 行间插入 */}
                      {!exporting && (
                        <button onClick={() => insertRowAfter(row.id)}
                          className="w-full flex items-center justify-center gap-2 py-2 text-sm text-slate-400 hover:text-emerald-500 hover:bg-emerald-50 border-2 border-dashed border-slate-200 hover:border-emerald-300 rounded-2xl transition-all">
                          <PlusCircle className="w-4 h-4" /> 在此行后插入
                        </button>
                      )}
                    </React.Fragment>
                  ))}
                </div>
              </div>
            </motion.section>
          )}
        </AnimatePresence>
      </main>

      <footer className="py-12 border-t border-slate-200 text-center space-y-4">
        <div className="flex items-center justify-center gap-1 text-slate-400 text-sm">
          <Zap className="w-4 h-4 fill-emerald-500 text-emerald-500" />
          <span>AI Generated Workout Analysis</span>
        </div>
        <p className="text-slate-400 text-xs">© 2024 FitExtract. All Rights Reserved.</p>
      </footer>
    </div>
  );
}