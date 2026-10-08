import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AvisoProvider, Carregando } from './components/ui'
import { AuthProvider } from './lib/auth'
import { CarrinhoProvider } from './lib/carrinho'
import { LojaProvider } from './lib/loja'
import Acompanhar from './site/Acompanhar'
import Cardapio from './site/Cardapio'
import Checkout from './site/Checkout'
import Conta, { Entrar } from './site/Conta'
import Inicio from './site/Inicio'
import SiteLayout from './site/SiteLayout'

// O painel só é baixado por quem entra em /admin; o cliente do site não paga por ele.
const AdminLayout = lazy(() => import('./admin/AdminLayout'))
const Painel = lazy(() => import('./admin/Painel'))
const Pedidos = lazy(() => import('./admin/Pedidos'))
const Pdv = lazy(() => import('./admin/Pdv'))
const Cozinha = lazy(() => import('./admin/Cozinha'))
const Clientes = lazy(() => import('./admin/Clientes'))
const CardapioAdmin = lazy(() => import('./admin/CardapioAdmin'))
const Estoque = lazy(() => import('./admin/Estoque'))
const Caixa = lazy(() => import('./admin/Caixa'))
const Entregas = lazy(() => import('./admin/Entregas'))
const Financeiro = lazy(() => import('./admin/Financeiro'))
const Fiscal = lazy(() => import('./admin/Fiscal'))
const Configuracoes = lazy(() => import('./admin/Configuracoes'))
const Analises = lazy(() => import('./admin/Analises'))
const Conteudo = lazy(() => import('./admin/Conteudo'))
const Auditoria = lazy(() => import('./admin/Auditoria'))
const Entregador = lazy(() => import('./site/Entregador'))

export default function App() {
  return (
    <BrowserRouter>
      <AvisoProvider>
        <LojaProvider>
          <AuthProvider>
            <CarrinhoProvider>
              <Suspense fallback={<Carregando />}>
                <Routes>
                  <Route element={<SiteLayout />}>
                    <Route index element={<Inicio />} />
                    <Route path="cardapio" element={<Cardapio />} />
                    <Route path="checkout" element={<Checkout />} />
                    <Route path="pedido" element={<Acompanhar />} />
                    <Route path="entrar" element={<Entrar />} />
                    <Route path="conta" element={<Conta />} />
                  </Route>
                  <Route path="entregador" element={<Entregador />} />
                  <Route path="admin" element={<AdminLayout />}>
                    <Route path="painel" element={<Painel />} />
                    <Route path="pedidos" element={<Pedidos />} />
                    <Route path="pdv" element={<Pdv />} />
                    <Route path="cozinha" element={<Cozinha />} />
                    <Route path="clientes" element={<Clientes />} />
                    <Route path="cardapio" element={<CardapioAdmin />} />
                    <Route path="estoque" element={<Estoque />} />
                    <Route path="caixa" element={<Caixa />} />
                    <Route path="entregas" element={<Entregas />} />
                    <Route path="financeiro" element={<Financeiro />} />
                    <Route path="fiscal" element={<Fiscal />} />
                    <Route path="configuracoes" element={<Configuracoes />} />
                    <Route path="analises" element={<Analises />} />
                    <Route path="conteudo" element={<Conteudo />} />
                    <Route path="auditoria" element={<Auditoria />} />
                  </Route>
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </Suspense>
            </CarrinhoProvider>
          </AuthProvider>
        </LojaProvider>
      </AvisoProvider>
    </BrowserRouter>
  )
}
