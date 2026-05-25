import { useEffect } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { useCompanyContextStore } from '@/stores/companyContextStore'
import ProtectedRoute from '@/routes/ProtectedRoute'
import LoadingScreen from '@/components/common/LoadingScreen'
import EmulatorBadge from '@/components/common/EmulatorBadge'

import LoginPage from '@/pages/auth/LoginPage'

import SuperAdminLayout from '@/pages/super-admin/SuperAdminLayout'
import CompaniesPage from '@/pages/super-admin/CompaniesPage'
import CompanyFormPage from '@/pages/super-admin/CompanyFormPage'

import AdminLayout from '@/pages/admin/AdminLayout'
import PosPage from '@/pages/admin/pos/PosPage'
import ReceiptPage from '@/pages/admin/pos/ReceiptPage'
import CategoriesPage from '@/pages/admin/menu/CategoriesPage'
import ItemsPage from '@/pages/admin/menu/ItemsPage'
import ModifiersPage from '@/pages/admin/menu/ModifiersPage'
import OrderHistoryPage from '@/pages/admin/orders/OrderHistoryPage'

import DisplayPage from '@/pages/display/DisplayPage'

const App = () => {
  const init = useAuthStore((s) => s.init)
  const initialized = useAuthStore((s) => s.initialized)
  const user = useAuthStore((s) => s.user)
  const setActiveCompany = useCompanyContextStore((s) => s.setActiveCompany)
  const activeCompanyId = useCompanyContextStore((s) => s.activeCompanyId)

  useEffect(() => {
    const unsub = init()
    return () => unsub()
  }, [init])

  useEffect(() => {
    if (!user) return
    if (user.role === 'admin' && user.companyId && activeCompanyId !== user.companyId) {
      setActiveCompany(user.companyId, false)
    }
  }, [user, activeCompanyId, setActiveCompany])

  if (!initialized) {
    return (
      <>
        <LoadingScreen label="Starting up..." />
        <EmulatorBadge />
      </>
    )
  }

  return (
    <>
      <EmulatorBadge />
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route path="/display/:companyId" element={<DisplayPage />} />

      <Route
        path="/super-admin"
        element={
          <ProtectedRoute allow={['super_admin']}>
            <SuperAdminLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<CompaniesPage />} />
        <Route path="companies" element={<CompaniesPage />} />
        <Route path="companies/new" element={<CompanyFormPage mode="create" />} />
        <Route path="companies/:companyId/edit" element={<CompanyFormPage mode="edit" />} />
      </Route>

      <Route
        path="/admin"
        element={
          <ProtectedRoute allow={['super_admin', 'admin']}>
            <AdminLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="pos" replace />} />
        <Route path="pos" element={<PosPage />} />
        <Route path="receipt/:orderId" element={<ReceiptPage />} />
        <Route path="menu/categories" element={<CategoriesPage />} />
        <Route path="menu/items" element={<ItemsPage />} />
        <Route path="menu/modifiers" element={<ModifiersPage />} />
        <Route path="orders" element={<OrderHistoryPage />} />
      </Route>

      <Route path="/" element={<Navigate to={user ? (user.role === 'super_admin' ? '/super-admin' : '/admin/pos') : '/login'} replace />} />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
    </>
  )
}

export default App
