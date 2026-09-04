'use client'

import { useState } from 'react'

/**
 * The one client-side island on the registration page — everything else stays a plain
 * server-rendered form, same shape as `login/page.tsx`. Blind retyping into two fields with
 * no way to check either is a real typo risk, so this toggles `type` between `password` and
 * `text` rather than adding a second hidden field nobody can proofread.
 */
export function PasswordField({
  id,
  name,
  label,
  autoComplete,
}: {
  id: string
  name: string
  label: string
  autoComplete: string
}) {
  const [visible, setVisible] = useState(false)

  return (
    <div className="password-field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        name={name}
        type={visible ? 'text' : 'password'}
        autoComplete={autoComplete}
        minLength={12}
        required
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
