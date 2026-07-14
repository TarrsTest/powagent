import { NextResponse } from 'next/server';

/** Uniform JSON success/error envelopes for the REST API. */

export const json = (data: unknown, status = 200) =>
  NextResponse.json(data, { status });

export const err = (status: number, message: string, extra?: object) =>
  NextResponse.json({ error: message, ...extra }, { status });

/** Read + parse a JSON body, returning null on any malformed input. */
export const readJson = async <T = Record<string, unknown>>(
  req: Request,
): Promise<T | null> => {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
};
