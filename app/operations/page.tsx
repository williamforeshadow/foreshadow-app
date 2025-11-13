'use client'

import { useState, useEffect, useMemo } from 'react'
import { supabase } from '@/lib/supabaseClient'

type Reservation = {
  id: string
  property_name: string
  guest_name: string
  check_in: string
  check_out: string
}

// Los Angeles timezone utilities
const LA_TIMEZONE = 'America/Los_Angeles'

// Get date-only in LA timezone (for day-based comparisons)
// This extracts what date a UTC timestamp represents in Los Angeles time
const getLADateOnly = (utcString: string): Date => {
  const utcDate = new Date(utcString)
  
  // Get the date components in LA timezone
  const year = parseInt(utcDate.toLocaleString('en-US', { timeZone: LA_TIMEZONE, year: 'numeric' }))
  const month = parseInt(utcDate.toLocaleString('en-US', { timeZone: LA_TIMEZONE, month: 'numeric' }))
  const day = parseInt(utcDate.toLocaleString('en-US', { timeZone: LA_TIMEZONE, day: 'numeric' }))
  
  // Create a date object representing this date at midnight in local time
  // (We're using local time to represent LA date, which is fine for date comparisons)
  return new Date(year, month - 1, day)
}

// Format datetime for display in LA timezone
const formatLADateTime = (utcString: string): string => {
  const date = new Date(utcString)
  return date.toLocaleString('en-US', {
    timeZone: LA_TIMEZONE,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  })
}

// Format date only for display in LA timezone
const formatLADate = (utcString: string): string => {
  const date = new Date(utcString)
  return date.toLocaleDateString('en-US', {
    timeZone: LA_TIMEZONE,
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  })
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

  // Calculate date range and properties for timeline (all dates in LA timezone)
  const { dateRange, properties } = useMemo(() => {
    if (reservations.length === 0) {
      return { dateRange: [], properties: [] }
    }

    // Find min and max dates from all check-in and check-out dates (converted to LA time)
    const allDates = reservations.flatMap(r => [
      getLADateOnly(r.check_in),
      getLADateOnly(r.check_out)
    ])
    
    // Get the actual date components (year, month, day) from the LA dates
    const minDate = allDates.reduce((min, d) => {
      const minYear = min.getFullYear()
      const minMonth = min.getMonth()
      const minDay = min.getDate()
      const dYear = d.getFullYear()
      const dMonth = d.getMonth()
      const dDay = d.getDate()
      
      if (dYear < minYear || 
          (dYear === minYear && dMonth < minMonth) ||
          (dYear === minYear && dMonth === minMonth && dDay < minDay)) {
        return d
      }
      return min
    })
    
    const maxDate = allDates.reduce((max, d) => {
      const maxYear = max.getFullYear()
      const maxMonth = max.getMonth()
      const maxDay = max.getDate()
      const dYear = d.getFullYear()
      const dMonth = d.getMonth()
      const dDay = d.getDate()
      
      if (dYear > maxYear || 
          (dYear === maxYear && dMonth > maxMonth) ||
          (dYear === maxYear && dMonth === maxMonth && dDay > maxDay)) {
        return d
      }
      return max
    })
    
    // Generate date range: 7 days before earliest to 7 days after latest
    const startDate = new Date(minDate)
    startDate.setDate(startDate.getDate() - 7)
    startDate.setHours(0, 0, 0, 0) // Normalize to midnight
    
    const endDate = new Date(maxDate)
    endDate.setDate(endDate.getDate() + 7)
    endDate.setHours(0, 0, 0, 0) // Normalize to midnight

    // Generate array of dates, all normalized to midnight
    const datesArray: Date[] = []
    const currentDate = new Date(startDate)
    currentDate.setHours(0, 0, 0, 0)
    
    while (currentDate <= endDate) {
      const dateCopy = new Date(currentDate)
      dateCopy.setHours(0, 0, 0, 0)
      datesArray.push(dateCopy)
      currentDate.setDate(currentDate.getDate() + 1)
    }

    // Get unique properties, sorted
    const uniqueProperties = Array.from(
      new Set(reservations.map(r => r.property_name))
    ).sort()

    return { dateRange: datesArray, properties: uniqueProperties }
  }, [reservations])

  // Calculate reservation block position and width (using LA timezone dates)
  const getReservationBlockStyle = (reservation: Reservation) => {
    // Convert check-in and check-out to LA timezone dates (already normalized to midnight)
    const checkIn = getLADateOnly(reservation.check_in)
    const checkOut = getLADateOnly(reservation.check_out)
    
    // Normalize both dates to midnight for comparison
    checkIn.setHours(0, 0, 0, 0)
    checkOut.setHours(0, 0, 0, 0)
    
    // Compare dates by year, month, day only (ignore time)
    const compareDates = (d1: Date, d2: Date): boolean => {
      const d1Norm = new Date(d1)
      d1Norm.setHours(0, 0, 0, 0)
      const d2Norm = new Date(d2)
      d2Norm.setHours(0, 0, 0, 0)
      return d1Norm.getFullYear() === d2Norm.getFullYear() &&
             d1Norm.getMonth() === d2Norm.getMonth() &&
             d1Norm.getDate() === d2Norm.getDate()
    }
    
    // Find indices in date range
    const startIndex = dateRange.findIndex(d => compareDates(d, checkIn))
    const endIndex = dateRange.findIndex(d => compareDates(d, checkOut))

    if (startIndex === -1 || endIndex === -1) {
      // Debug logging if dates don't match
      if (startIndex === -1) {
        console.warn('Check-in date not found:', {
          guest: reservation.guest_name,
          check_in_utc: reservation.check_in,
          check_in_la: `${checkIn.getFullYear()}-${String(checkIn.getMonth() + 1).padStart(2, '0')}-${String(checkIn.getDate()).padStart(2, '0')}`,
          dateRangeStart: dateRange[0] ? `${dateRange[0].getFullYear()}-${String(dateRange[0].getMonth() + 1).padStart(2, '0')}-${String(dateRange[0].getDate()).padStart(2, '0')}` : 'none',
          dateRangeEnd: dateRange[dateRange.length - 1] ? `${dateRange[dateRange.length - 1].getFullYear()}-${String(dateRange[dateRange.length - 1].getMonth() + 1).padStart(2, '0')}-${String(dateRange[dateRange.length - 1].getDate()).padStart(2, '0')}` : 'none',
          dateRangeLength: dateRange.length
        })
      }
      if (endIndex === -1) {
        console.warn('Check-out date not found:', {
          guest: reservation.guest_name,
          check_out_utc: reservation.check_out,
          check_out_la: `${checkOut.getFullYear()}-${String(checkOut.getMonth() + 1).padStart(2, '0')}-${String(checkOut.getDate()).padStart(2, '0')}`
        })
      }
      return { display: 'none' }
    }

    // Calculate position and width (inclusive of both start and end days)
    const leftPercent = (startIndex / dateRange.length) * 100
    const numberOfDays = endIndex - startIndex + 1
    const widthPercent = (numberOfDays / dateRange.length) * 100

    return {
      left: `${leftPercent}%`,
      width: `${widthPercent}%`,
    }
  }

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

      {/* --- Reservations Timeline --- */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-2xl font-bold text-gray-800">Reservations Timeline</h2>
          <div className="text-sm text-gray-500">
            {reservations.length} reservation{reservations.length !== 1 ? 's' : ''}
          </div>
        </div>
        
        {reservations.length === 0 ? (
          <div className="text-gray-500 p-12 flex items-center justify-center border-2 border-dashed rounded-xl bg-gray-50">
            <div className="text-center">
              <div className="text-4xl mb-2">📅</div>
              <p className="text-lg font-medium">No reservations found</p>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-gray-200 shadow-lg overflow-hidden bg-white">
            {/* Grid Container - Independent Scroll */}
            <div className="flex overflow-hidden" style={{ maxHeight: '80vh' }}>
              {/* Sticky Property Column */}
              <div className="sticky left-0 z-20 w-36 flex-shrink-0 bg-gradient-to-b from-gray-50 to-white border-r border-gray-200 shadow-sm">
                <div className="h-10 flex items-center px-2 font-bold text-gray-900 bg-gradient-to-r from-gray-100 to-gray-50 border-b border-gray-200 sticky top-0">
                  <span className="text-xs uppercase tracking-wide">Property</span>
                </div>
                <div className="overflow-y-auto" style={{ maxHeight: 'calc(80vh - 40px)' }}>
                  {properties.map((property, idx) => (
                    <div
                      key={property}
                      className={`h-8 flex items-center px-2 font-medium text-gray-800 border-b border-gray-100 transition-colors ${
                        idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'
                      } hover:bg-blue-50`}
                    >
                      <span className="truncate text-xs">{property}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Scrollable Timeline Grid */}
              <div className="flex-1 overflow-auto">
                {/* Date Header Row - Sticky */}
                <div className="sticky top-0 z-10 flex min-w-max bg-white border-b border-gray-200 shadow-sm h-10">
                  {dateRange.map((date, idx) => {
                    // Check if this date is today in LA timezone
                    const today = new Date()
                    const todayLA = today.toLocaleDateString('en-US', { timeZone: LA_TIMEZONE })
                    // dateRange dates already represent LA dates, so compare directly
                    const dateStr = date.toLocaleDateString('en-US')
                    const isToday = dateStr === todayLA
                    const isWeekend = date.getDay() === 0 || date.getDay() === 6
                    
                    return (
                      <div
                        key={idx}
                        className={`w-8 px-1 py-1 border-r border-gray-200 flex flex-col items-center justify-center select-none transition-colors relative ${
                          isToday 
                            ? 'bg-gradient-to-b from-blue-100 to-blue-50 border-blue-300' 
                            : isWeekend
                            ? 'bg-gray-50'
                            : 'bg-white hover:bg-gray-50'
                        }`}
                      >
                        {/* Today indicator - vertical line */}
                        {isToday && (
                          <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-blue-600 z-20"></div>
                        )}
                        <span
                          className={`text-[10px] font-bold leading-tight ${
                            isToday ? 'text-blue-700' : 'text-gray-700'
                          }`}
                        >
                          {date.toLocaleDateString('en-US', { 
                            month: 'short', 
                            day: 'numeric' 
                          })}
                        </span>
                        <span className={`text-[8px] font-medium leading-tight ${
                          isToday ? 'text-blue-600' : 'text-gray-500'
                        }`}>
                          {date.toLocaleDateString('en-US', { 
                            weekday: 'short' 
                          })}
                        </span>
                        {isToday && (
                          <div className="mt-0.5 w-1.5 h-1.5 rounded-full bg-blue-500"></div>
                        )}
                      </div>
                    )
                  })}
                </div>

                {/* Timeline Rows for Each Property - True Grid with Continuous Blocks */}
                <div className="relative min-w-max">
                  {properties.map((property, propIdx) => {
                    const propertyReservations = reservations.filter(
                      r => r.property_name === property
                    )
                    
                    // Helper to check if a reservation covers a specific date
                    const reservationCoversDate = (reservation: Reservation, date: Date): boolean => {
                      const checkIn = getLADateOnly(reservation.check_in)
                      const checkOut = getLADateOnly(reservation.check_out)
                      checkIn.setHours(0, 0, 0, 0)
                      checkOut.setHours(0, 0, 0, 0)
                      date.setHours(0, 0, 0, 0)
                      
                      // Check if date is between check-in and check-out (inclusive)
                      return date.getTime() >= checkIn.getTime() && date.getTime() <= checkOut.getTime()
                    }
                    
                    // Get reservation for a specific date (if multiple, take first)
                    const getReservationForDate = (date: Date): Reservation | null => {
                      return propertyReservations.find(r => reservationCoversDate(r, date)) || null
                    }
                    
                    // Calculate reservation blocks as continuous spans
                    const getReservationBlocks = () => {
                      const blocks: Array<{
                        reservation: Reservation
                        startIdx: number
                        endIdx: number
                      }> = []
                      
                      propertyReservations.forEach(reservation => {
                        const checkIn = getLADateOnly(reservation.check_in)
                        const checkOut = getLADateOnly(reservation.check_out)
                        checkIn.setHours(0, 0, 0, 0)
                        checkOut.setHours(0, 0, 0, 0)
                        
                        const startIdx = dateRange.findIndex(d => {
                          const dNorm = new Date(d)
                          dNorm.setHours(0, 0, 0, 0)
                          return dNorm.getTime() === checkIn.getTime()
                        })
                        
                        const endIdx = dateRange.findIndex(d => {
                          const dNorm = new Date(d)
                          dNorm.setHours(0, 0, 0, 0)
                          return dNorm.getTime() === checkOut.getTime()
                        })
                        
                        if (startIdx !== -1 && endIdx !== -1) {
                          blocks.push({ reservation, startIdx, endIdx })
                        }
                      })
                      
                      return blocks
                    }
                    
                    const reservationBlocks = getReservationBlocks()
                    
                    // Check if today falls in this row's date range for indicator
                    const today = new Date()
                    const todayLA = today.toLocaleDateString('en-US', { timeZone: LA_TIMEZONE })
                    const todayIndex = dateRange.findIndex(d => {
                      const dStr = d.toLocaleDateString('en-US')
                      return dStr === todayLA
                    })
                    
                    return (
                      <div
                        key={property}
                        className={`h-8 flex border-b border-gray-100 relative ${
                          propIdx % 2 === 0 ? 'bg-white' : 'bg-gray-50/30'
                        }`}
                      >
                        {/* Grid cells - one for each day (for borders/background) */}
                        {dateRange.map((date, dateIdx) => {
                          const isWeekend = date.getDay() === 0 || date.getDay() === 6
                          const isWeekBoundary = dateIdx % 7 === 0
                          const isToday = dateIdx === todayIndex
                          
                          return (
                            <div
                              key={dateIdx}
                              className={`w-8 border-r relative ${
                                isWeekBoundary 
                                  ? 'border-blue-200' 
                                  : isWeekend
                                  ? 'border-gray-100'
                                  : 'border-gray-50'
                              }`}
                            >
                              {/* Today indicator - vertical line */}
                              {isToday && (
                                <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-blue-600 z-30"></div>
                              )}
                            </div>
                          )
                        })}
                        
                        {/* Reservation blocks as continuous spans */}
                        {reservationBlocks.map((block, blockIdx) => {
                          const leftPercent = (block.startIdx / dateRange.length) * 100
                          const widthPercent = ((block.endIdx - block.startIdx + 1) / dateRange.length) * 100
                          
                          return (
                            <div
                              key={`${block.reservation.id}-${blockIdx}`}
                              className="absolute top-0 bottom-0 bg-gradient-to-br from-blue-500 via-blue-600 to-blue-700 cursor-pointer hover:from-blue-600 hover:via-blue-700 hover:to-blue-800 transition-colors group z-10"
                              style={{
                                left: `${leftPercent}%`,
                                width: `${widthPercent}%`,
                              }}
                              title={`${block.reservation.guest_name}\nCheck-in (LA): ${formatLADateTime(block.reservation.check_in)}\nCheck-out (LA): ${formatLADateTime(block.reservation.check_out)}`}
                            >
                              {/* Guest name displayed at the start (left) of the block */}
                              <div className="absolute inset-0 flex items-center px-1.5">
                                <span className="text-white text-[9px] font-semibold drop-shadow-sm group-hover:font-bold whitespace-nowrap leading-tight">
                                  {block.reservation.guest_name}
                                </span>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>
        )}
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