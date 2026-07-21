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
import Suppliers from './pages/Suppliers'
import Products from './pages/Products'
import Locations from './pages/Locations'
import Inbound from './pages/Inbound'
import GoodsInwards from './pages/GoodsInwards'
import GoodsOutwards from './pages/GoodsOutwards'
import Orders from './pages/Orders'
import CustomerService from './pages/CustomerService'
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
        <Route path="/suppliers" element={<Suppliers />} />
        <Route path="/products" element={<Products />} />
        <Route path="/locations" element={<Locations />} />
        <Route path="/inbound" element={<Inbound />} />
        <Route path="/goods-inwards" element={<GoodsInwards />} />
        <Route path="/goods-outwards" element={<GoodsOutwards />} />
        <Route path="/orders" element={<Orders />} />
        <Route path="/customer-service" element={<CustomerService />} />
        <Route path="/returns" element={<Returns />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
    </Routes>
  )
}
