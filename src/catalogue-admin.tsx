import { useCallback, useState, type FormEvent } from 'react'
import { backend, errorMessage, unwrap } from './data'
import { useLoad } from './hooks'
import { parseCatalogue } from './catalogue-import'
import { Status } from './ui'

type Draft = ReturnType<typeof parseCatalogue>
type Batch = {id:string;label:string;approved_at:string | null;published_count:number | null}
type Check = {accepted:number;duplicates:number;batch_id:string | null}

export function CatalogueImport() {
  const [revision, setRevision] = useState(0)
  const load = useCallback(async () => {
    void revision
    return unwrap(await backend().from('catalogue_batches').select('id,label,approved_at,published_count').order('staged_at',{ascending:false}).limit(100)) as Batch[]
  },[revision])
  const batches = useLoad(load)
  const [draft,setDraft] = useState<Draft>()
  const [selected,setSelected] = useState<Batch>()
  const [records,setRecords] = useState<Draft['editions']>([])
  const [label,setLabel] = useState('')
  const [ready,setReady] = useState(false)
  const [confirm,setConfirm] = useState(false)
  const [busy,setBusy] = useState(false)
  const [notice,setNotice] = useState('')
  const [error,setError] = useState('')

  async function action(work: () => Promise<void>) {
    setBusy(true);setNotice('');setError('')
    try { await work() } catch (error) { setError(errorMessage(error)) }
    finally { setBusy(false) }
  }

  async function validate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const file = new FormData(event.currentTarget).get('catalogue')
    const name = label.trim()
    setDraft(undefined);setReady(false)
    await action(async () => {
      if (!(file instanceof File) || !file.size || file.size > 8_000_000 || !/\.(csv|json)$/i.test(file.name)) throw new Error('Choose a CSV or JSON file under 8 MB.')
      const parsed = parseCatalogue(await file.text(),file.name)
      setDraft(parsed)
      let accepted = 0, duplicates = parsed.duplicates
      for (let offset=0;offset<parsed.editions.length;offset+=200) {
        const result = unwrap(await backend().rpc('stage_catalogue_batch',{
          batch_label:name,editions:parsed.editions.slice(offset,offset+200),dry_run:true,
        })) as Check
        accepted+=result.accepted;duplicates+=result.duplicates
      }
      setReady(accepted > 0)
      setNotice(`Dry run complete. ${accepted} ready to stage; ${duplicates} duplicates.`)
    })
  }

  async function stage() {
    if (!draft || !ready) return
    await action(async () => {
      for (let offset=0;offset<draft.editions.length;offset+=200) {
        const editions = draft.editions.slice(offset,offset+200)
        const batch_label = `${label.trim()} · ${1+offset/200}`
        const current = unwrap(await backend().rpc('stage_catalogue_batch',{batch_label,editions,dry_run:true})) as Check
        if (!current.accepted) continue
        unwrap(await backend().rpc('stage_catalogue_batch',{batch_label,editions,dry_run:false}))
        setRevision(value => value+1)
      }
      setReady(false);setNotice('New editions were staged for admin review.')
    })
  }

  async function review(batch: Batch) {
    setSelected(undefined);setRecords([]);setConfirm(false)
    await action(async () => {
      const result = unwrap(await backend().from('catalogue_staging').select('record').eq('batch_id',batch.id).order('edition_key').limit(200)) as {record:Draft['editions'][number]}[]
      setRecords(result.map(item=>item.record));setSelected(batch)
    })
  }

  async function publish() {
    if (!selected || !confirm) return
    await action(async () => {
      const count = unwrap(await backend().rpc('publish_catalogue_batch',{target_batch:selected.id})) as number
      setSelected(undefined);setConfirm(false);setRevision(value=>value+1);setNotice(`Published ${count} editions.`)
    })
  }

  return <>
    <h1>Catalogue imports</h1>
    <p>Validate a CSV or JSON file, stage new editions, then review each batch before publishing.</p>
    <form className="form-card" onSubmit={event=>void validate(event)}>
      <label className="field"><span>Batch name</span><input value={label} required maxLength={135} disabled={busy}
        onChange={event=>{setLabel(event.target.value);setReady(false)}} /></label>
      <label className="field"><span>Catalogue file</span><input name="catalogue" type="file" accept=".csv,.json" required disabled={busy}
        onChange={()=>{setReady(false);setDraft(undefined)}} /></label>
      <div className="actions"><button className="button button-outline" disabled={busy}>Dry run</button>
        {ready && <button className="button button-primary" type="button" disabled={busy} onClick={()=>void stage()}>Stage new editions</button>}</div>
    </form>
    {error && <Status error>{error}</Status>}{notice && <Status>{notice}</Status>}
    <h2>Import batches</h2>
    {batches.loading && <Status>Loading batches…</Status>}
    {batches.error && <Status error>{batches.error}</Status>}
    {!batches.loading && !batches.error && !batches.data?.length && <p>No staged batches.</p>}
    {batches.data?.map(batch=><div className="form-card" key={batch.id}>
      <strong>{batch.label}</strong>
      {batch.approved_at ? <span>{batch.published_count} published</span> :
        <button className="button button-outline" disabled={busy} onClick={()=>void review(batch)}>Review batch</button>}
    </div>)}
    {selected && <section aria-label="Batch review">
      <h2>{selected.label}</h2>
      <div className="table-wrap"><table><thead><tr><th>Edition</th><th>Collection</th><th>Evidence</th></tr></thead><tbody>
        {records.map(record=><tr key={record.slug}><td>{record.title}<br/>{record.author} · {record.publication_year} · {record.language} · {record.format}</td>
          <td>{record.audience} / {record.topic}<br/>{record.subject} · {record.scholarly_level}</td>
          <td><a href={String(record.source_url)} target="_blank" rel="noreferrer">Edition source</a><br/>
            <a href={String(record.rights_url)} target="_blank" rel="noreferrer">Rights evidence</a><br/>
            {record.download_url && <><a href={String(record.download_url)} target="_blank" rel="noreferrer">Download source</a><br/></>}
            Verified {record.verified_on}<br/>{record.rights}</td></tr>)}
      </tbody></table></div>
      <label className="check"><input type="checkbox" checked={confirm} onChange={event=>setConfirm(event.target.checked)} />
        I reviewed the editions, download access, and rights evidence in this batch.</label>
      <button className="button button-primary" disabled={!confirm || busy || !records.length} onClick={()=>void publish()}>Publish reviewed batch</button>
    </section>}
  </>
}
