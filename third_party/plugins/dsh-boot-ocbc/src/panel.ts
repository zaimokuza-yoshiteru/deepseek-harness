/** Replay control contributed to the official Plugin Manager detail actions. */
import { createElement, Fragment } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { PropsRuntime, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { PluginDetailProps } from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'

type LocaleKey = 'playAnimation' | 'loopAnimation' | 'exitLoop'
type ReplayActionProps = PropsRuntime<'plugins.detail.actions'> & PluginDetailProps & PropsLocale<typeof NS>
type BootApi = { replay(): void; toggleLoop(exitLabel?: string): void; dispose(): void }

const NS = 'dshBootOcbc'
const en: Record<LocaleKey, string> = { playAnimation: 'Play animation', loopAnimation: 'Loop animation', exitLoop: 'Exit loop · Esc' }
const zh: Record<LocaleKey, string> = { playAnimation: '播放动画', loopAnimation: '循环播放', exitLoop: '退出循环 · Esc' }

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { dshBootOcbc: LocaleKey }
}

declare global {
  var __DSH_BOOT_OCBC__: BootApi | undefined
}

function ReplayAction({ subject, t }: ReplayActionProps) {
  if (subject.kind !== 'bundle' || subject.pkg.name !== 'dsh-boot-ocbc') return null
  return createElement(Fragment, null, createElement(Button, {
    variant: 'outline', size: 'sm',
    onClick: () => globalThis.__DSH_BOOT_OCBC__?.replay(),
  }, t('playAnimation')), createElement(Button, {
    variant: 'outline', size: 'sm',
    onClick: () => globalThis.__DSH_BOOT_OCBC__?.toggleLoop(t('exitLoop')),
  }, t('loopAnimation')))
}

export const inject = ['slots', 'locale']

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'dsh-boot-ocbc: panel locale')
  ctx.effect(() => {
    let live = true
    const existing = document.getElementById('dsh-boot-ocbc-bootstrap') as HTMLScriptElement | null
    let script = existing ?? undefined
    if (globalThis.__DSH_BOOT_OCBC__ === undefined && script === undefined) {
      script = document.createElement('script')
      script.id = 'dsh-boot-ocbc-bootstrap'
      script.async = true
      script.src = new URL('/plugins/dsh-boot-ocbc/lib/boot.js', location.href).href
      script.onerror = () => script?.remove()
      document.head.append(script)
    }
    script?.addEventListener('load', () => { if (!live) globalThis.__DSH_BOOT_OCBC__?.dispose() }, { once: true })
    return () => {
      live = false
      script?.remove()
      globalThis.__DSH_BOOT_OCBC__?.dispose()
    }
  }, 'dsh-boot-ocbc: replay runtime lifecycle')
  ctx.slots.inject('plugins.detail.actions', () => ctx.slots.register({
    name: 'plugins.detail.actions', id: 'dsh-boot-ocbc.replay', order: 0, locale: NS,
  }, ReplayAction))
}
