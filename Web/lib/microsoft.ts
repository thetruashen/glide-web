export type MinecraftAccount={name:string;id:string;accessToken:string;expires:number;clientId:string};
let current:MinecraftAccount|undefined;
export function account(){return current;}
export function setAccount(value:MinecraftAccount|undefined){current=value;}
export async function microsoft(operation:string,body:unknown){
  const response=await fetch(`/api/microsoft/${operation}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const value=await response.json();
  if(!response.ok)throw new Error(value.error || 'Microsoft sign-in failed.');
  return value;
}
export function readyAccount():MinecraftAccount{
  if(!current || current.expires<Date.now()+120000)throw new Error('Sign in with Microsoft in Account before launching.');
  return current;
}
