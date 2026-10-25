import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

// Note: StrictMode is intentionally omitted. Its double-mount in development
// would create and then terminate the embedding worker immediately, killing
// the in-flight model download.
const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element');

createRoot(container).render(<App />);
