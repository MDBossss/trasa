import type { SocketKind, SwitchKind } from './types'

// TEM Čatež MODUL, codes as listed by modulmanager.tem.si (2026-10). Listed without the colour suffix
// (PW = bijela sjaj, …): the colour of elements and frames is picked when buying.
export const TEM_SWITCH: Record<SwitchKind, { code: string | null; name: string }> = {
  obicni: { code: 'SM10', name: 'prekidač jednopolni 16AX' },
  tipkalo: { code: 'SM11', name: 'tipkalo jednopolno 16A' },
  izmjenicni: { code: 'SM60', name: 'prekidač izmjenični 16AX' },
  krizni: { code: 'SM70', name: 'prekidač križni 16AX' },
  serijski: { code: null, name: 'serijski prekidač (nema u MODUL programu: dva SM10)' },
}
export const TEM_SOCKET: Record<SocketKind, { code: string; name: string }> = {
  schuko: { code: 'VM10', name: 'utičnica šuko 16A, 2M' },
  euro: { code: 'VM20', name: 'utičnica euro 10A, 1M' },
  rj45: { code: 'KM32', name: 'utičnica RJ45 CAT6a, 1M' },
  tv: { code: 'KM10', name: 'TV utičnica osnovna 0 dB, 1M' },
}
// frame (okvir LINE) and carrier (nosač) by frame size; a single device in a round Ø60 box sits in a 2M frame
export const TEM_FRAME: Record<number, { frame: string; carrier: string; carrierName: string }> = {
  2: { frame: 'OL20', carrier: 'NM20', carrierName: 'nosač s kandžama 2M' },
  3: { frame: 'OL30', carrier: 'NM30', carrierName: 'nosač s vijcima 3M' },
  4: { frame: 'OL40', carrier: 'NM40', carrierName: 'nosač s vijcima 4M' },
  7: { frame: 'OL70', carrier: 'NM70', carrierName: 'nosač s vijcima 7M' },
}
export const TEM_BLANK = { code: 'TM21', name: 'slijepi modul (polnilo) 1M' }
export const temCode = (code: string, _color = true) => code
