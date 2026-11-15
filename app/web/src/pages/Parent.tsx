import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';

type Props = { onBack: () => void; onToast: (m: string) => void };
type Tab = 'overview' | 'library' | 'plan' | 'questions';

export default function Parent({ onBack, onToast }: Props) {
  const [tab, setTab] = useState<Tab>('overview');
  const [ov, setOv] = useState<any>(null);
  const [books, setBooks] = useState<any[]>([]);
  const [plan, setPlan] = useState<any>(null);
  const [qs, setQs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = async () => {
    setLoading(true);
    try {
      const [o, b, p] = await Promise.all([api.parentOverview(), api.books(), api.plan()]);
      setOv(o); setBooks(b); setPlan(p);
    } catch (e: any) { onToast(e.message ?? '加载失败'); }
    finally { setLoading(false); }
  };

  useEffect(() => { reload(); }, []);
  useEffect(() => {
    if (tab === 'questions') api.parentQuestions().then(setQs).catch(() => {});
  }, [tab]);

  return (
    <>
      <div className="topbar">
        <span className="brand">伴学小岛 · 家长端</span>
        <div className="tabs">
          {([['overview', '概览'], ['library', '教材'], ['plan', '计划'], ['questions', '题库']] as [Tab, string][]).map(([k, n]) => (
            <button key={k} className="tab" aria-pressed={tab === k} onClick={() => setTab(k)}>{n}</button>
          ))}
          <button className="tab" onClick={onBack}>回小家</button>
        </div>
      </div>

      <div className="wrap">
        {loading && <div className="empty"><div className="e">⏳</div>加载中…</div>}

        {!loading && tab === 'overview' && ov && <Overview ov={ov} />}
        {!loading && tab === 'library' && (
          <Library books={books} onToast={onToast} onChanged={reload} />
        )}
        {!loading && tab === 'plan' && (
          <PlanEditor plan={plan} books={books} onToast={onToast} onChanged={reload} />
        )}
        {!loading && tab === 'questions' && (
          <QuestionBank qs={qs} onToast={onToast} onChanged={() => api.parentQuestions().then(setQs)} />
        )}
      </div>
    </>
  );
}

/* ---------------- 概览 ---------------- */
function Overview({ ov }: { ov: any }) {
  const forecast = ov.forecast ?? [];
  const max = Math.max(1, ...forecast.map((f: any) => f.count));
  const m = ov.mastery ?? { total: 0, avgMastery: 0, buckets: {} };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="grid-3">
        <div className="stat">
          <div className="k">平均掌握度</div>
          <div className="v">{m.avgMastery}%</div>
        </div>
        <div className="stat">
          <div className="k">已建立复习卡</div>
          <div className="v">{m.total}</div>
        </div>
        <div className="stat">
          <div className="k">完成的练习</div>
          <div className="v">{ov.sessionCount ?? 0}</div>
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <h2 style={{ fontSize: 16, color: 'var(--green)' }}>未来 7 天复习量</h2>
          <p className="sub" style={{ fontSize: 13, color: 'var(--ink-soft)', marginTop: 4 }}>
            按艾宾浩斯间隔排出，每天不宜超过 12 个
          </p>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, height: 130, marginTop: 16 }}>
            {forecast.map((f: any) => (
              <div key={f.date} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 12, color: 'var(--ink-soft)' }}>{f.count || ''}</span>
                <div style={{
                  width: '100%', borderRadius: 8,
                  height: `${Math.max(4, (f.count / max) * 88)}px`,
                  background: f.count > 12 ? 'var(--rose)' : 'linear-gradient(180deg,var(--mint),var(--green-l))',
                  transition: 'height 400ms',
                }} />
                <span style={{ fontSize: 11, color: 'var(--ink-soft)' }}>{f.date.slice(5)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <h2 style={{ fontSize: 16, color: 'var(--green)' }}>掌握分布</h2>
          <p className="sub" style={{ fontSize: 13, color: 'var(--ink-soft)', marginTop: 4 }}>
            只有独立答对才会上台阶
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}>
            {([['刚接触', m.buckets.new, '#EFE7D6'], ['学习中', m.buckets.learning, 'var(--apricot)'],
               ['复习中', m.buckets.reviewing, 'var(--mint)'], ['已稳定', m.buckets.mastered, 'var(--green-l)']] as any[]).map(([name, n, color]) => (
              <div key={name} className="need-row" style={{ gridTemplateColumns: '68px 1fr 36px' }}>
                <span>{name}</span>
                <div className="bar"><i style={{ width: `${m.total ? (n / m.total) * 100 : 0}%`, background: color }} /></div>
                <b>{n}</b>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card">
        <h2 style={{ fontSize: 16, color: 'var(--green)' }}>宠物</h2>
        <div className="grid-3" style={{ marginTop: 12 }}>
          <div className="stat"><div className="k">等级</div><div className="v">Lv.{ov.pet?.level}</div></div>
          <div className="stat"><div className="k">亲密度</div><div className="v">{ov.pet?.bond}</div></div>
          <div className="stat"><div className="k">阶段</div><div className="v" style={{ fontSize: 20 }}>{ov.pet?.stageName}</div></div>
        </div>
      </div>
    </div>
  );
}

/* ---------------- 教材 ---------------- */
function Library({ books, onToast, onChanged }: { books: any[]; onToast: (m: string) => void; onChanged: () => void }) {
  const [binding, setBinding] = useState<any>(null);
  const [importing, setImporting] = useState(false);
  const [pages, setPages] = useState<any[] | null>(null);
  const [meta, setMeta] = useState({ series: 'RAZ', level: 'B', title: '' });
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);

  const onPick = async (f: File | null) => {
    if (!f) return;
    setImporting(true); setBusy(true); setFileName(f.name);
    try {
      const r = await api.importPdf(f);
      setPages(r.pages);
      setMeta((m) => ({ ...m, title: m.title || f.name.replace(/\.pdf$/i, '') }));
      onToast(`已解析 ${r.pages.length} 页`);
    } catch (e: any) { onToast(e.message ?? 'PDF 解析失败'); }
    finally { setBusy(false); }
  };

  const commit = async () => {
    if (!pages || !meta.title.trim()) { onToast('请填写书名'); return; }
    setBusy(true);
    try {
      const r = await api.commitBook({
        seriesCode: meta.series, seriesName: meta.series,
        level: meta.level, title: meta.title.trim(),
        pages, autoGenerate: true,
      });
      onToast(`导入成功，生成 ${r.generated?.created ?? 0} 道题`);
      setPages(null); setImporting(false); setFileName('');
      onChanged();
    } catch (e: any) { onToast(e.message ?? '导入失败'); }
    finally { setBusy(false); }
  };

  const gen = async (id: string) => {
    try {
      const r = await api.generate(id);
      onToast(`生成 ${r.created} 道新题`);
      onChanged();
    } catch (e: any) { onToast(e.message ?? '生成失败'); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {!importing && (
        <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ fontSize: 40 }}>📚</div>
          <div style={{ flex: 1 }}>
            <h2 style={{ fontSize: 16, color: 'var(--green)' }}>导入 PDF 教材</h2>
            <p style={{ fontSize: 13, color: 'var(--ink-soft)' }}>
              自动提取每页文字并切成句子，随后按句子生成基础题。音频可以在导入后逐页绑定。
            </p>
          </div>
          <label className="btn sm" style={{ cursor: 'pointer' }}>
            选择 PDF
            <input type="file" accept="application/pdf" hidden onChange={(e) => onPick(e.target.files?.[0] ?? null)} />
          </label>
        </div>
      )}

      {importing && (
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <h2 style={{ fontSize: 16, color: 'var(--green)', flex: 1 }}>确认导入 · {fileName}</h2>
            <button className="chip" onClick={() => { setImporting(false); setPages(null); }}>取消</button>
          </div>

          {busy && !pages && <div className="empty"><div className="e">⏳</div>正在解析 PDF…</div>}

          {pages && (
            <>
              <div className="grid-3" style={{ marginTop: 16 }}>
                <div className="field"><label>系列</label>
                  <input className="input" value={meta.series} onChange={(e) => setMeta({ ...meta, series: e.target.value })} />
                </div>
                <div className="field"><label>级别</label>
                  <input className="input" value={meta.level} onChange={(e) => setMeta({ ...meta, level: e.target.value })} />
                </div>
                <div className="field"><label>书名</label>
                  <input className="input" value={meta.title} onChange={(e) => setMeta({ ...meta, title: e.target.value })} />
                </div>
              </div>

              <p style={{ fontSize: 13, color: 'var(--ink-soft)', marginTop: 14 }}>
                共 {pages.length} 页，切出 {pages.reduce((n, p) => n + (p.sentences?.length ?? 0), 0)} 句
              </p>

              <div className="list" style={{ marginTop: 10, maxHeight: 320, overflow: 'auto' }}>
                {pages.slice(0, 20).map((p) => (
                  <div className="row-item" key={p.index}>
                    <span className="pill">P{p.index}</span>
                    <div className="grow">
                      <div className="t" style={{ fontSize: 13.5 }}>
                        {(p.sentences ?? []).slice(0, 2).join(' / ') || '(无文字)'}
                      </div>
                      <div className="d">{(p.sentences ?? []).length} 句</div>
                    </div>
                  </div>
                ))}
              </div>

              <button className="btn primary block" style={{ marginTop: 16 }} disabled={busy} onClick={commit}>
                {busy ? '导入中…' : '确认导入并生成题目'}
              </button>
            </>
          )}
        </div>
      )}

      {binding && (
        <AudioBinder
          book={binding}
          onToast={onToast}
          onClose={() => setBinding(null)}
          onDone={() => { setBinding(null); onChanged(); }}
        />
      )}

      <div className="card">
        <h2 style={{ fontSize: 16, color: 'var(--green)' }}>我的书架</h2>
        {books.length === 0 ? (
          <div className="empty"><div className="e">📭</div>还没有教材，先导入一本 PDF</div>
        ) : (
          <div className="list" style={{ marginTop: 14 }}>
            {books.map((b) => (
              <div className="row-item" key={b.id}>
                <span style={{ fontSize: 24 }}>📖</span>
                <div className="grow">
                  <div className="t">{b.title}</div>
                  <div className="d">{b.series_name} · {b.level} · {b.pages} 页 · {b.sentences} 句 · {b.questions} 题</div>
                </div>
                <button className="btn ghost sm" onClick={() => setBinding(b)}>绑定音频</button>
                <button className="btn ghost sm" onClick={() => gen(b.id)}>补题</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------- 计划 ---------------- */
function PlanEditor({ plan, books, onToast, onChanged }: { plan: any; books: any[]; onToast: (m: string) => void; onChanged: () => void }) {
  const today = new Date();
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday); d.setDate(monday.getDate() + i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const existing = (plan?.days ?? []).find((x: any) => x.date === key);
    return {
      key, label: ['一', '二', '三', '四', '五', '六', '日'][i],
      bookId: existing?.book_id ?? (books[0]?.id ?? ''), 
      pageFrom: existing?.page_from ?? 1,
      pageTo: existing?.page_to ?? 4,
    };
  }), [plan, books]);

  const [rows, setRows] = useState(days);
  useEffect(() => { setRows(days); }, [days]);

  const save = async () => {
    try {
      await api.savePlan({
        weekStart: rows[0].key,
        days: rows.filter(r => r.bookId).map(r => ({
          date: r.key, bookId: r.bookId, pageFrom: Number(r.pageFrom), pageTo: Number(r.pageTo), targetMinutes: 15,
        })),
      });
      onToast('计划已保存');
      onChanged();
    } catch (e: any) { onToast(e.message ?? '保存失败'); }
  };

  if (books.length === 0) {
    return <div className="card"><div className="empty"><div className="e">📚</div>先导入教材，才能制定计划</div></div>;
  }

  return (
    <div className="card">
      <h2 style={{ fontSize: 16, color: 'var(--green)' }}>本周计划</h2>
      <p style={{ fontSize: 13, color: 'var(--ink-soft)', marginTop: 4 }}>
        每天读几页。孩子用点读笔或音频学完后，回到小岛做同一批内容的练习。
      </p>

      <div className="list" style={{ marginTop: 16 }}>
        {rows.map((r, i) => (
          <div className="row-item" key={r.key} style={{ gap: 10 }}>
            <span className="pill" style={{ minWidth: 44, justifyContent: 'center' }}>周{r.label}</span>
            <select className="select" style={{ flex: 2, minWidth: 120 }} value={r.bookId}
              onChange={(e) => setRows(rows.map((x, j) => j === i ? { ...x, bookId: e.target.value } : x))}>
              {books.map((b) => <option key={b.id} value={b.id}>{b.title}</option>)}
            </select>
            <input className="input" style={{ width: 74 }} type="number" min={1} value={r.pageFrom}
              onChange={(e) => setRows(rows.map((x, j) => j === i ? { ...x, pageFrom: e.target.value } : x))} />
            <span style={{ color: 'var(--ink-soft)' }}>–</span>
            <input className="input" style={{ width: 74 }} type="number" min={1} value={r.pageTo}
              onChange={(e) => setRows(rows.map((x, j) => j === i ? { ...x, pageTo: e.target.value } : x))} />
            <span style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>页</span>
          </div>
        ))}
      </div>

      <button className="btn primary block" style={{ marginTop: 16 }} onClick={save}>保存本周计划</button>
    </div>
  );
}

/* ---------------- 题库 ---------------- */
function QuestionBank({ qs, onToast, onChanged }: { qs: any[]; onToast: (m: string) => void; onChanged: () => void }) {
  const [filter, setFilter] = useState('');
  const list = qs.filter(q => !filter || q.type.includes(filter) || q.prompt.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <h2 style={{ fontSize: 16, color: 'var(--green)', flex: 1 }}>题库 · {qs.length} 道</h2>
        <input className="input" style={{ maxWidth: 220 }} placeholder="搜索题目…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>
      <p style={{ fontSize: 13, color: 'var(--ink-soft)', marginTop: 6 }}>
        外部 agent 可通过 MCP 端点 <code>POST /mcp</code> 批量灌题，也可用内置生成器按句子出题。
      </p>

      {list.length === 0 ? (
        <div className="empty"><div className="e">🗂️</div>还没有题目</div>
      ) : (
        <div className="list" style={{ marginTop: 14, maxHeight: 560, overflow: 'auto' }}>
          {list.map((q) => (
            <div className="row-item" key={q.id}>
              <span className="pill gray">{q.type}</span>
              <div className="grow">
                <div className="t" style={{ fontFamily: 'Andika, ui-rounded, sans-serif' }}>{q.prompt}</div>
                <div className="d">
                  {q.payload?.options?.map((o: any) => o.text).filter(Boolean).join(' / ')}
                  {' · 答案: '}{q.answer?.text ?? q.answer?.index}
                </div>
              </div>
              <span className="pill">L{q.difficulty}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


/* ---------------- 音频绑定 ---------------- */
function AudioBinder({ book, onToast, onClose, onDone }: {
  book: any; onToast: (m: string) => void; onClose: () => void; onDone: () => void;
}) {
  const [detail, setDetail] = useState<any>(null);
  const [coverage, setCoverage] = useState<any>(null);
  const [pageFrom, setPageFrom] = useState(1);
  const [pageTo, setPageTo] = useState(book.pages || 1);
  const [file, setFile] = useState<File | null>(null);
  const [info, setInfo] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.book(book.id).then((d) => {
      setDetail(d);
      setPageTo(d.book.page_count || 1);
    }).catch(() => {});
    api.audioStatus(book.id).then(setCoverage).catch(() => {});
  }, [book.id]);

  const sentences = useMemo(() => {
    if (!detail) return [] as any[];
    return detail.pages
      .filter((p: any) => p.index_no >= pageFrom && p.index_no <= pageTo)
      .flatMap((p: any) => p.sentences.map((s: any) => ({ ...s, page: p.index_no })));
  }, [detail, pageFrom, pageTo]);

  const analyze = async (f: File | null) => {
    if (!f) return;
    setFile(f); setBusy(true); setInfo(null);
    try {
      const r = await api.audioAnalyze(f, book.id, pageFrom, pageTo);
      setInfo(r);
      onToast(`识别出 ${r.segments.length} 段，共 ${r.duration}s`);
    } catch (e: any) { onToast(e.message ?? '音频分析失败'); }
    finally { setBusy(false); }
  };

  const confirm = async () => {
    if (!info) return;
    setBusy(true);
    try {
      const r = await api.audioBind({
        bookId: book.id, pageFrom, pageTo,
        sourcePath: info.sourcePath, segments: info.segments, autoGenerate: true,
      });
      onToast(`已绑定 ${r.bound} 句，生成 ${r.generated?.created ?? 0} 道听力题`);
      onDone();
    } catch (e: any) { onToast(e.message ?? '绑定失败'); }
    finally { setBusy(false); }
  };

  return (
    <div className="card" style={{ borderColor: 'var(--mint)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <h2 style={{ fontSize: 16, color: 'var(--green)', flex: 1 }}>
          绑定音频 · {book.title}
        </h2>
        <button className="chip" onClick={onClose}>关闭</button>
      </div>

      <p style={{ fontSize: 13, color: 'var(--ink-soft)', marginTop: 6 }}>
        {coverage
          ? `当前 ${coverage.withAudio}/${coverage.total} 句有音频（${coverage.ratio}%）${coverage.ffmpeg ? '' : ' · 未检测到 ffmpeg，无法切分'}`
          : '正在检查…'}
      </p>

      <div className="grid-3" style={{ marginTop: 14 }}>
        <div className="field">
          <label>起始页</label>
          <input className="input" type="number" min={1} value={pageFrom}
                 onChange={(e) => { setPageFrom(Number(e.target.value)); setInfo(null); }} />
        </div>
        <div className="field">
          <label>结束页</label>
          <input className="input" type="number" min={1} value={pageTo}
                 onChange={(e) => { setPageTo(Number(e.target.value)); setInfo(null); }} />
        </div>
        <div className="field">
          <label>音频文件</label>
          <label className="btn ghost sm" style={{ cursor: 'pointer', minHeight: 46 }}>
            {file ? file.name.slice(0, 14) : '选择音频'}
            <input type="file" accept="audio/*" hidden onChange={(e) => analyze(e.target.files?.[0] ?? null)} />
          </label>
        </div>
      </div>

      <p style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginTop: 10 }}>
        该范围共 {sentences.length} 句。会按停顿自动切成同样数量，然后逐句绑定。
      </p>

      {busy && <div className="empty" style={{ padding: 24 }}><div className="e">⏳</div>处理中…</div>}

      {info && !busy && (
        <>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12, flexWrap: 'wrap' }}>
            <span className="pill">时长 {info.duration}s</span>
            <span className="pill">切出 {info.segments.length} 段</span>
            <span className={`pill ${info.method === 'silence' ? '' : 'warn'}`}>
              {info.method === 'silence' ? '按停顿切分' : info.method === 'even' ? '按句数均分' : '整段'}
            </span>
          </div>

          <div className="list" style={{ marginTop: 12, maxHeight: 280, overflow: 'auto' }}>
            {info.segments.map((seg: any, i: number) => (
              <div className="row-item" key={seg.index} style={{ padding: '10px 14px' }}>
                <span className="pill">{i + 1}</span>
                <div className="grow">
                  <div className="t" style={{ fontSize: 13.5 }}>
                    {sentences[i]?.text ?? <span style={{ color: 'var(--rose)' }}>（无对应句子，将被跳过）</span>}
                  </div>
                  <div className="d">{seg.start}s – {seg.end}s · {seg.duration}s</div>
                </div>
              </div>
            ))}
          </div>

          <button className="btn primary block" style={{ marginTop: 14 }} disabled={busy} onClick={confirm}>
            确认绑定并生成听力题
          </button>
        </>
      )}
    </div>
  );
}
