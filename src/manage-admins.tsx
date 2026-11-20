import { useState, type FormEvent } from 'react'
import { useAuth } from './auth'
import { backend, errorMessage, unwrap } from './data'
import { Status } from './ui'

interface Account {
  user_id: string
  email: string
  is_admin: boolean
}

export function ManageAdmins() {
  const { user } = useAuth()
  const [account, setAccount] = useState<Account>()
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  async function lookup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const email = String(new FormData(event.currentTarget).get('email') ?? '').trim()
    setAccount(undefined)
    setConfirm(false)
    setError('')
    setNotice('')
    setBusy(true)
    try {
      const matches = unwrap(await backend().rpc('find_admin_account',{account_email:email})) as Account[]
      if (matches.length === 1) setAccount(matches[0])
      else setNotice('No unique, confirmed account matched that email.')
    } catch (error) { setError(errorMessage(error)) }
    finally { setBusy(false) }
  }

  async function save(target: Account) {
    const grant = !target.is_admin
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const changed = unwrap(await backend().rpc('set_admin_access',{account_id:target.user_id,grant_access:grant}))
      setAccount({...target,is_admin:grant})
      setConfirm(false)
      setNotice(changed ? (grant ? 'Admin access granted.' : 'Admin access revoked.') : 'This account already has the requested access.')
    } catch (error) { setError(errorMessage(error)) }
    finally { setBusy(false) }
  }

  return <>
    <h1>Manage Admins</h1>
    <p>Find a registered account by its exact email address.</p>
    <form className="form-card" onSubmit={event => void lookup(event)}>
      <label className="field"><span>Account email</span><input name="email" type="email" required maxLength={254}
        disabled={busy} onChange={() => {setAccount(undefined);setConfirm(false);setError('');setNotice('')}} /></label>
      <button className="button button-primary" disabled={busy}>Find account</button>
    </form>
    {error && <Status error>{error}</Status>}
    {notice && <Status>{notice}</Status>}
    {account && <section className="form-card" aria-labelledby="matched-account">
      <h2 id="matched-account">{account.email}</h2>
      <p>{account.is_admin ? 'Administrator' : 'Registered reader'}</p>
      {account.user_id === user?.id ? <p>This is your signed-in account.</p> : confirm ? <>
        <p>{account.is_admin ? 'Remove administrator access for this account?' : 'Give this account full administrator access?'}</p>
        <div className="actions">
          <button className={account.is_admin ? 'button button-danger' : 'button button-primary'} disabled={busy}
            onClick={() => void save(account)}>{account.is_admin ? 'Confirm revocation' : 'Confirm grant'}</button>
          <button className="button button-outline" disabled={busy} onClick={() => setConfirm(false)}>Cancel</button>
        </div>
      </> : <button className="button button-outline" disabled={busy} onClick={() => setConfirm(true)}>
        {account.is_admin ? 'Revoke admin access' : 'Grant admin access'}
      </button>}
    </section>}
  </>
}
