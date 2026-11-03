'use client'
import { Toaster } from 'sonner'
import PaywallHost from '@/components/billing/PaywallHost'

export function Providers() {
  return (
    <>
      <Toaster position="top-center" theme="dark" richColors />
      <PaywallHost />
    </>
  )
}
