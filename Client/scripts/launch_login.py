"""A private launch-time choice; never ask for Microsoft passwords or tokens."""
from pathlib import Path
import re
import tkinter as tk

def choose_account(instance,version,loader):
    root=tk.Tk();root.title('pigmc · Ready to play');root.configure(bg='#111719')
    root.geometry('760x570');root.resizable(False,False)
    result=[]
    def label(text,size=12,color='#9caaa8'):
        tk.Label(root,text=text,font=('DejaVu Sans',size),fg=color,bg='#111719').pack(pady=8)
    icon=tk.PhotoImage(file=str(Path(__file__).resolve().parents[1]/'assets'/'pigmc.png'));root.iconphoto(True,icon)
    root.pig_icon=icon.subsample(2)
    tk.Label(root,image=root.pig_icon,bg='#111719').pack(pady=5)
    label('pigmc',28,'#30d987');label(instance,20,'#ffffff');label(f'Minecraft {version} · {loader.title()}')
    label('Choose how to play this session',14,'#ffffff')
    def microsoft():result.append(('microsoft',None));root.destroy()
    tk.Button(root,text='Sign in with Microsoft',command=microsoft,bg='#24ba74',fg='#06150d',font=('DejaVu Sans',13),width=32,pady=10).pack(pady=12)
    label('Or play offline with a username')
    username=tk.StringVar(value='GlidePlayer')
    tk.Entry(root,textvariable=username,font=('DejaVu Sans',13),justify='center',bg='#222c30',fg='#ffffff',insertbackground='#ffffff',width=30).pack()
    error=tk.StringVar()
    tk.Label(root,textvariable=error,bg='#111719',fg='#ff9494').pack()
    def offline():
        name=username.get().strip()
        if not re.fullmatch(r'[A-Za-z0-9_]{3,16}',name):error.set('Use 3–16 letters, numbers or underscores.');return
        result.append(('offline',name));root.destroy()
    tk.Button(root,text='Play offline',command=offline,bg='#283438',fg='#ffffff',font=('DejaVu Sans',12),width=32,pady=8).pack()
    root.mainloop()
    if not result:raise RuntimeError('Launch cancelled at the account screen.')
    return result[0]
