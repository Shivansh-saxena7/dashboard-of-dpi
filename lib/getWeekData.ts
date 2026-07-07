export function getWeekData(data:any[]){

const now = new Date();

return data.filter((item)=>{

const d = new Date(item.Date);

const diff =
(now.getTime()-d.getTime())/
(1000*60*60*24);

return diff <= 7;

});

}