import { NextRequest, NextResponse } from "next/server"

const AW_BASE = process.env.ACTIVITYWATCH_URL ?? "http://localhost:5600/api/0"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params
  const upstreamPath = path.join("/")
  const search = request.nextUrl.search

  const url = `${AW_BASE}/${upstreamPath}${search}`

  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
  })

  const data = await res.json()
  return NextResponse.json(data, { status: res.status })
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params
  const upstreamPath = path.join("/")

  const url = `${AW_BASE}/${upstreamPath}`
  const body = await request.text()

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  })

  const data = await res.json()
  return NextResponse.json(data, { status: res.status })
}
