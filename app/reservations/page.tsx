'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'

type Reservation = {
  id: string
  property_name: string
  guest_name: string
  check_in: string
  check_out: string
}

export default function ReservationsPage() {
  const [data, setData] = useState<Reservation[]>([])

  useEffect(() => {
    async function loadReservations() {
      const { data, error } = await supabase
        .from('reservations')
        .select('*')
        .order('check_in', { ascending: true })

      if (error) {
        console.error('Supabase Error:', error)
      } else {
        setData(data || [])
      }
    }

    loadReservations()
  }, [])

  return (
    <main className="p-6">
      <h1 className="text-2xl font-semibold mb-4">Reservations</h1>
      {data.length === 0 ? (
        <p>No reservations found.</p>
      ) : (
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
            {data.map((r) => (
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
      )}
    </main>
  )
}