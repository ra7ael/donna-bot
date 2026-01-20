import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
  // Verifica se existe um "cookie" de login (você pode melhorar isso depois)
  const isAuthenticated = request.cookies.get('amber_session')

  // Se tentar acessar o dashboard sem o cookie, manda para o login
  if (!isAuthenticated && !request.nextUrl.pathname.startsWith('/login')) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  return NextResponse.next()
}

// Define quais caminhos o segurança deve vigiar
export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
}
