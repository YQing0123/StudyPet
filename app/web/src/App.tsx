import V2App from './v2/V2App';
import Admin from './v2/Admin';

export default function App() {
  return /^\/admin\/?$/.test(location.pathname) ? <Admin /> : <V2App />;
}
