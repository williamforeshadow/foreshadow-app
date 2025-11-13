'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabaseClient'

type Reservation = {
  id: string
  property_name: string
  guest_name: string
  check_in: string
  check_out: string
}

export default function OperationsPage() {
  const [reservations, setReservations] = useState<Reservation[]>([])
  const [rpcData, setRpcData] = useState<any[]>([])
  const [activeRpc, setActiveRpc] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load reservations on mount
  useEffect(() => {
    async function load() {
      const { data, error } = await supabase
        .from('reservations')
        .select('*')
        .order('check_in', { ascending: true })

      if (error) console.error(error)
      else setReservations(data || [])
    }
    load()
  }, [])

  const rpcList = [
    { name: 'unassigned_cleanings', label: '🧹 Unassigned Cleanings' },
    { name: 'todays_cleanings', label: '🗓️ Today\'s Cleanings' },
    { name: 'upcoming_checkins_with_status', label: '🏠 Upcoming Check-ins' },
    { name: 'upcoming_checkouts_with_cleaning', label: '🚪 Upcoming Check-outs' },
  ]

  async function runRpc(name: string) {
    setLoading(true)
    setError(null)
    setActiveRpc(name)
    setRpcData([])

    const { data, error } = await supabase.rpc(name)

    if (error) {
      console.error('RPC Error:', error)
      setError(error.message)
    } else {
      setRpcData(data || [])
    }

    setLoading(false)
  }

  return (
    <main className="p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Operations Console</h1>

      {/* --- Reservations --- */}
      <section>
        <h2 className="text-xl mb-2">Reservations</h2>
        <table className="min-w-full border">
          <thead>
            <tr>
              <th className="p-2 border">Property</th>
              <th className="p-2 border">Guest</th>
              <th className="p-2 border">Check-In</th>
              <th className="p-2 border">Check-Out</th>
            </tr>
          </thead>
          <tbody>
            {reservations.map((r) => (
              <tr key={r.id}>
                <td className="p-2 border">{r.property_name}</td>
                <td className="p-2 border">{r.guest_name}</td>
                <td className="p-2 border">
                  {new Date(r.check_in).toLocaleDateString()}
                </td>
                <td className="p-2 border">
                  {new Date(r.check_out).toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* --- RPC Buttons --- */}
      <section className="border-t pt-4">
        <h2 className="text-xl mb-3">Run Quick Reports</h2>
        <div className="flex flex-wrap gap-2 mb-4">
          {rpcList.map((rpc) => (
            <button
              key={rpc.name}
              onClick={() => runRpc(rpc.name)}
              className={`px-4 py-2 rounded border ${
                activeRpc === rpc.name
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 hover:bg-gray-200'
              }`}
              disabled={loading}
            >
              {loading && activeRpc === rpc.name ? 'Running...' : rpc.label}
            </button>
          ))}
        </div>

        {error && (
          <div className="text-red-600 mb-2">Error: {error}</div>
        )}

        {rpcData.length > 0 && (
          <div>
            <h3 className="text-lg mb-2">Results for: {activeRpc}</h3>
            <div className="overflow-auto max-h-[500px] border rounded">
              <table className="min-w-full border-collapse">
                <thead>
                  <tr>
                    {Object.keys(rpcData[0]).map((key) => (
                      <th key={key} className="p-2 border bg-gray-50">
                        {key}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rpcData.map((row, i) => (
                    <tr key={i}>
                      {Object.values(row).map((val, j) => (
                        <td key={j} className="p-2 border text-sm">
                          {String(val ?? '')}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </main>
  )
}