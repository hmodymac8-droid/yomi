import App from './App'

/** Always-on-top reader. The main window keeps running underneath. */
export default function MiniApp(): React.JSX.Element {
  return <App mini />
}
