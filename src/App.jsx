import { Routes, Route } from 'react-router-dom'
import ProtectedRoute from './components/ProtectedRoute'
import Layout from './components/Layout'
import Login from './pages/Login'
import Join from './pages/Join'
import Signup from './pages/Signup'
import ForgotPassword from './pages/ForgotPassword'
import ResetPassword from './pages/ResetPassword'
import Dashboard from './pages/Dashboard'
import PurchaseOrders from './pages/PurchaseOrders'
import ImportOrder from './pages/ImportOrder'
import Suppliers from './pages/Suppliers'
import Products from './pages/Products'
import Locations from './pages/Locations'
import Restocks from './pages/Restocks'
import NewRestockRequest from './pages/NewRestockRequest'
import FulfilRequest from './pages/FulfilRequest'
import RestockOrder from './pages/RestockOrder'
import Inbound from './pages/Inbound'
import GoodsInwards from './pages/GoodsInwards'
import GoodsOutwards from './pages/GoodsOutwards'
import Orders from './pages/Orders'
import CustomerService from './pages/CustomerService'
import OrderIssues from './pages/OrderIssues'
import Returns from './pages/Returns'
import Admin from './pages/Admin'
import Settings from './pages/Settings'

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/join" element={<Join />} />
      <Route
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<Dashboard />} />
        <Route path="/purchase-orders" element={<PurchaseOrders />} />
        <Route path="/purchase-orders/import" element={<ImportOrder />} />
        <Route path="/suppliers" element={<Suppliers />} />
        <Route path="/products" element={<Products />} />
        <Route path="/locations" element={<Locations />} />
        <Route path="/restocks" element={<Restocks />} />
        <Route path="/restocks/new" element={<NewRestockRequest />} />
        <Route path="/restocks/:requestId/fulfil" element={<FulfilRequest />} />
        <Route path="/restocks/orders/:orderId" element={<RestockOrder />} />
        <Route path="/inbound" element={<Inbound />} />
        <Route path="/goods-inwards" element={<GoodsInwards />} />
        <Route path="/goods-outwards" element={<GoodsOutwards />} />
        <Route path="/orders" element={<Orders />} />
        <Route path="/customer-service" element={<CustomerService />} />
        <Route path="/order-issues" element={<OrderIssues />} />
        <Route path="/returns" element={<Returns />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
    </Routes>
  )
}
