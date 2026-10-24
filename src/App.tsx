import { useEffect } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { useCompanyContextStore } from '@/stores/companyContextStore'
import ProtectedRoute from '@/routes/ProtectedRoute'
import PermissionGate from '@/routes/PermissionGate'
import LoadingScreen from '@/components/common/LoadingScreen'
import EmulatorBadge from '@/components/common/EmulatorBadge'
import DesktopUpdateDialog from '@/components/common/DesktopUpdateDialog'
import { defaultAdminPath } from '@/utils/permissions'

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
import SettingsPage from '@/pages/admin/settings/SettingsPage'
import TeamPage from '@/pages/admin/team/TeamPage'

import DisplayPage from '@/pages/display/DisplayPage'
import CustomerDisplayPage from '@/pages/display/CustomerDisplayPage'

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
    if (
      (user.role === 'admin' || user.role === 'staff') &&
      user.companyId &&
      activeCompanyId !== user.companyId
    ) {
      setActiveCompany(user.companyId, false)
    }
  }, [user, activeCompanyId, setActiveCompany])

  if (!initialized) {
    return (
      <>
        <LoadingScreen label="Starting up..." />
        <EmulatorBadge />
        <DesktopUpdateDialog />
      </>
    )
  }

  return (
    <>
      <EmulatorBadge />
      <DesktopUpdateDialog />
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route path="/display/:companyId" element={<DisplayPage />} />
      <Route path="/customer-display" element={<CustomerDisplayPage />} />

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
          <ProtectedRoute allow={['super_admin', 'admin', 'staff']}>
            <AdminLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to={defaultAdminPath(user)} replace />} />
        <Route
          path="pos"
          element={
            <PermissionGate permission="pos">
              <PosPage />
            </PermissionGate>
          }
        />
        <Route
          path="receipt/:orderId"
          element={
            <PermissionGate permission="pos">
              <ReceiptPage />
            </PermissionGate>
          }
        />
        <Route
          path="menu/categories"
          element={
            <PermissionGate permission="menu">
              <CategoriesPage />
            </PermissionGate>
          }
        />
        <Route
          path="menu/items"
          element={
            <PermissionGate permission="menu">
              <ItemsPage />
            </PermissionGate>
          }
        />
        <Route
          path="menu/modifiers"
          element={
            <PermissionGate permission="menu">
              <ModifiersPage />
            </PermissionGate>
          }
        />
        <Route
          path="orders"
          element={
            <PermissionGate permission="orders">
              <OrderHistoryPage />
            </PermissionGate>
          }
        />
        <Route
          path="settings"
          element={
            <PermissionGate anyOf={['settings', 'receipt']}>
              <SettingsPage />
            </PermissionGate>
          }
        />
        <Route
          path="team"
          element={
            <PermissionGate permission="team">
              <TeamPage />
            </PermissionGate>
          }
        />
      </Route>

      <Route
        path="/"
        element={
          <Navigate
            to={user ? defaultAdminPath(user) : '/login'}
            replace
          />
        }
      />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
    </>
  )
}

export default App
