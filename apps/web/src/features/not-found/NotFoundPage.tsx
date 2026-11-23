import {Link} from 'react-router-dom';
import './not-found.css';

export function NotFoundPage(){
  return <main className="not-found" aria-labelledby="not-found-title"><small>ERRO 404</small><h1 id="not-found-title">Página não encontrada</h1><p>O endereço que você abriu não existe ou foi movido. Volte ao início para continuar de onde parou.</p><Link className="not-found-link" to="/">Voltar ao início</Link></main>
}
