import { MatchStatus } from '@/lib/types'
import { STATUS_LABEL, STATUS_COLOR } from '@/lib/utils'
import Badge from './Badge'

export default function StatusBadge({ status }: { status: MatchStatus }) {
  return <Badge className={STATUS_COLOR[status]}>{STATUS_LABEL[status]}</Badge>
}
