'use client'

import { useRef, useState } from 'react'

/**
 * The one client-side island on the registration page — everything else stays a plain
 * server-rendered form, same shape as `login/page.tsx`. It earns the JavaScript twice:
 * blind retyping into two fields with no way to check either is a real typo risk, and a
 * mismatch caught here costs nothing, where the same mismatch caught by the submit route
 * costs a round trip that empties every field on the way back.
 *
 * The comparison is a convenience, not the rule: `register/submit/route.ts` checks it
 * again, because a form can always be posted without this component ever running.
 */
export function PasswordFields() {
  const confirmRef = useRef<HTMLInputElement>(null)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')

  /**
   * Reported through the field's own validity rather than as our own message, so the
   * browser refuses the submit for us and says so where it says everything else.
   */
  function compare(next: { password: string; confirm: string }) {
    const field = confirmRef.current
    if (!field) return
    const mismatched = next.confirm !== '' && next.password !== next.confirm
    field.setCustomValidity(mismatched ? 'Those two passwords do not match.' : '')
  }

  return (
    <>
      <PasswordInput
        id="password"
        name="password"
        label="Password"
        value={password}
        onValueChange={(value) => {
          setPassword(value)
          compare({ password: value, confirm })
        }}
      />
      <PasswordInput
        id="confirmPassword"
        name="confirmPassword"
        label="Confirm password"
        value={confirm}
        inputRef={confirmRef}
        onValueChange={(value) => {
          setConfirm(value)
          compare({ password, confirm: value })
        }}
      />
    </>
  )
}

function PasswordInput({
  id,
  name,
  label,
  value,
  onValueChange,
  inputRef,
}: {
  id: string
  name: string
  label: string
  value: string
  onValueChange: (value: string) => void
  inputRef?: React.RefObject<HTMLInputElement | null>
}) {
  const [visible, setVisible] = useState(false)

  return (
    <div className="password-field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        name={name}
        ref={inputRef}
        type={visible ? 'text' : 'password'}
        autoComplete="new-password"
        minLength={8}
        required
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
      />
      <button
        type="button"
        aria-pressed={visible}
        aria-label={`${visible ? 'Hide' : 'Show'} ${label.toLowerCase()}`}
        onClick={() => setVisible((current) => !current)}
      >
        {visible ? 'Hide' : 'Show'}
      </button>
    </div>
  )
}
