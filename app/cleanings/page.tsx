'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'

type Cleaning = {
  id: string
  property_name: string | null
  scheduled_start: string | null
  assigned_staff: string | null
  status: string | null
  reservation_id: string | null
  earliest_start: string | null
  latest_finish: string | null
}

export default function CleaningsPage() {
  const [data, setData] = useState<Cleaning[]>([])
  const [rpcData, setRpcData] = useState<any[]>([])

  useEffect(() => {
    async function loadData() {
      // 1️⃣ Fetch from the cleanings table
      const { data: cleanings, error } = await supabase
        .from('cleanings')
        .select('*')
        .limit(5)

      if (error) console.error('Cleanings error:', error)
      else setData(cleanings || [])

      // 2️⃣ Test an RPC (replace this with your actual function name)
      const { data: rpcResult, error: rpcError } = await supabase
        .rpc('upcoming_checkouts_with_cleaning')

      if (rpcError) console.error('RPC error:', rpcError)
      else setRpcData(rpcResult || [])
    }

    loadData()
  }, [])

  return (
    <main className="p-6">
      <h1 className="text-2xl font-semibold mb-4">Cleanings (test)</h1>

      <h2 className="text-xl mb-2">Cleanings Table</h2>
      <pre className="bg-gray-100 p-2 rounded mb-6 text-sm">
        {JSON.stringify(data, null, 2)}
      </pre>

      <h2 className="text-xl mb-2">RPC Result</h2>
      <pre className="bg-gray-100 p-2 rounded text-sm">
        {JSON.stringify(rpcData, null, 2)}
      </pre>
    </main>
  )
}