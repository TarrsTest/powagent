import { NextResponse, type NextRequest } from 'next/server';
import { handleTextRequest } from '@/lib/text/handler';

export function GET(request: NextRequest) {
  const { status, body } = handleTextRequest(request.nextUrl.searchParams);
  return NextResponse.json(body, { status });
}
