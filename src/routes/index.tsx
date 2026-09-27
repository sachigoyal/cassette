import { createFileRoute } from '@tanstack/react-router'
import { CassettePlayer } from '#/components/CassettePlayer'

export const Route = createFileRoute('/')({ component: Home })

function Home() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <CassettePlayer />
    </main>
  )
}
