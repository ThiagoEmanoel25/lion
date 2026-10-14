import {config} from 'dotenv';
import {resolve} from 'node:path';
import {existsSync} from 'node:fs';
import {buildApp} from './app.js';

const candidates=[resolve(process.cwd(),'.env'),resolve(process.cwd(),'../../.env')];
const envPath=candidates.find(existsSync);
if(envPath)config({path:envPath});
const app=await buildApp();
const port=Number(process.env.API_PORT??3333);
try{await app.listen({port,host:'0.0.0.0'})}catch(error){app.log.error(error);process.exit(1)}
